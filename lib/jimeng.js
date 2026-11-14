/**
 * Jimeng (即梦) web API client.
 *
 * Reuses the sign-in state of the installed Jimeng desktop app: its Electron
 * cookie jar stores the `jimeng.jianying.com` cookies in plaintext, so the
 * desktop session is read directly instead of asking for a token.
 *
 * @module @local/dsh-jimeng-seedance/jimeng
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'

const ORIGIN = 'https://jimeng.jianying.com'
const AID = 513695
const APP_VERSION = '5.8.0'
const PLATFORM_CODE = '7'
const DRAFT_VERSION = '3.3.20'
const WEB_VERSION = '7.5.0'

/** Cookies that carry the signed-in session; anything else is optional telemetry. */
const SESSION_COOKIES = [
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'sid_guard',
  'sid_ucp_v1',
  'ssid_ucp_v1',
  'uid_tt',
  'uid_tt_ss',
  'ttwid',
  'odin_tt',
  'store-region',
  'store-region-src',
  'user_spaces_idc',
  '_tea_web_id',
  'uifid',
  's_v_web_id',
  'fpk1',
  'n_mh',
  'is_staff_user',
]

/** Model id → the `model_req_key` the web draft API expects. */
export const MODELS = {
  'seedance-2.5': 'dreamina_seedance_45_pro',
  'seedance-2.0': 'dreamina_seedance_40_pro',
  'seedance-2.0-fast': 'dreamina_seedance_40',
  'seedance-2.0-mini': 'dreamina_seedance_40_mini',
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

/** Per-model generation bounds, taken from the model_config the API returns. */
export const MODEL_LIMITS = {
  'seedance-2.5': { resolutions: ['720p'], durations: range(4, 30), ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  'seedance-2.0': { resolutions: ['720p'], durations: range(4, 15), ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  'seedance-2.0-fast': { resolutions: ['720p'], durations: range(4, 15), ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  'seedance-2.0-mini': { resolutions: ['720p'], durations: range(4, 15), ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
}

/** Terminal task statuses observed from `get_history_by_ids`. */
const STATUS_FAILED = new Set([30, 40])
const STATUS_DONE = new Set([50])

/** Candidate cookie databases, most specific first. */
export function cookieDbCandidates() {
  const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return [
    join(roaming, 'dreamina-desktop', 'Partitions', 'dreamina-web', 'Network', 'Cookies'),
    join(roaming, 'dreamina-desktop', 'Network', 'Cookies'),
  ]
}

/** First existing cookie database, or `undefined`. */
export function findCookieDb(configured) {
  if (configured !== undefined && configured !== '' && existsSync(configured)) return configured
  return cookieDbCandidates().find((path) => existsSync(path))
}

/**
 * Read the Jimeng session cookies out of the desktop app's cookie jar.
 * @param dbPath - absolute path to the Electron `Cookies` SQLite database.
 * @returns the `Cookie` header value.
 */
export async function readSessionCookie(dbPath) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db
      .prepare(`select name, value from cookies where host_key like '%jianying.com' and length(value) > 0`)
      .all()
    const byName = new Map()
    for (const row of rows) if (!byName.has(row.name)) byName.set(row.name, row.value)
    if (!byName.has('sessionid') && !byName.has('sid_tt')) {
      throw new Error('即梦桌面端尚未登录：Cookies 里没有 sessionid。请先打开即梦 AI 客户端并完成登录。')
    }
    return SESSION_COOKIES.filter((name) => byName.has(name))
      .map((name) => `${name}=${byName.get(name)}`)
      .join('; ')
  } finally {
    db.close()
  }
}

/** MD5 signature the web draft API requires on every call. */
function sign(uri, deviceTime) {
  return createHash('md5')
    .update(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${APP_VERSION}|${deviceTime}||11ac`)
    .digest('hex')
}

const WEB_ID = String(Math.floor(Math.random() * 1e18) + 7e18)

/** Describe a transport failure well enough to act on it. */
function describeNetworkError(uri, error) {
  const cause = error?.cause
  const detail = cause?.code ?? cause?.errno ?? cause?.message ?? error?.message ?? String(error)
  return new Error(`连接即梦接口失败（${uri}）：${detail}。请检查网络或代理设置后重试。`)
}

/** One signed request, retried on transport errors. */
async function send(cookie, method, uri, body, query, attempt = 0) {
  const deviceTime = Math.floor(Date.now() / 1000)
  try {
    const response = await fetch(`${ORIGIN}${uri}?${query}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Cookie: cookie,
        'Device-Time': String(deviceTime),
        Sign: sign(uri, deviceTime),
        'Sign-Ver': '1',
        Appid: String(AID),
        Appvr: APP_VERSION,
        Pf: PLATFORM_CODE,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/ai-tool/video/generate`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      },
      body,
    })
    return await response.text()
  } catch (error) {
    if (attempt < 2) {
      await new Promise((done) => setTimeout(done, 800 * (attempt + 1)))
      return send(cookie, method, uri, body, query, attempt + 1)
    }
    throw describeNetworkError(uri, error)
  }
}

/**
 * One signed call against the Jimeng web API.
 * @returns the unwrapped `data` payload.
 */
async function call(cookie, method, uri, data, extraParams = {}) {
  const query = new URLSearchParams({
    aid: String(AID),
    device_platform: 'web',
    region: 'CN',
    webId: WEB_ID,
    ...extraParams,
  }).toString()
  const text = await send(cookie, method, uri, data === undefined ? undefined : JSON.stringify(data), query)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`即梦接口返回了非 JSON 响应：${text.slice(0, 200)}`)
  }
  if (parsed.ret !== undefined && parsed.ret !== '0') {
    const hint = parsed.ret === '1006' || parsed.ret === '5000' ? '（积分不足）' : ''
    throw new Error(`即梦接口错误 ret=${parsed.ret}${hint}：${parsed.errmsg ?? '未知错误'}`)
  }
  return parsed.data ?? parsed
}

/** Remaining credits, used to fail early instead of at submit time. */
export async function readCredit(cookie) {
  const data = await call(cookie, 'POST', '/commerce/v1/benefits/user_credit', {})
  const credit = data?.credit ?? {}
  const vip = Number(credit.vip_credit ?? 0)
  const gift = Number(credit.gift_credit ?? 0)
  const purchase = Number(credit.purchase_credit ?? 0)
  return { vip, gift, purchase, total: vip + gift + purchase }
}

/**
 * Submit one text-to-video task.
 * @returns the history record id used for polling.
 */
export async function submitVideo(cookie, { prompt, model = 'seedance-2.5', ratio = '16:9', duration = 5, resolution = '720p' }) {
  const modelReqKey = MODELS[model]
  if (modelReqKey === undefined) throw new Error(`未知模型 ${model}；可用：${Object.keys(MODELS).join(', ')}`)

  const componentId = randomUUID().toUpperCase()
  const metrics = JSON.stringify({
    enterFrom: 'click',
    isDefaultSeed: 1,
    promptSource: 'custom',
    isRegenerate: false,
    originSubmitId: randomUUID().toUpperCase(),
  })
  const commerce = { benefit_type: '', resource_id: 'generate_video', resource_id_type: 'str', resource_sub_type: 'aigc' }
  const draft = {
    type: 'draft',
    id: randomUUID().toUpperCase(),
    min_version: '3.0.5',
    is_from_tsn: true,
    version: DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [
      {
        type: 'video_base_component',
        id: componentId,
        min_version: '1.0.0',
        metadata: {
          type: '',
          id: randomUUID().toUpperCase(),
          created_platform: 3,
          created_platform_version: '',
          created_time_in_ms: Date.now(),
          created_did: '',
        },
        generate_type: 'gen_video',
        aigc_mode: 'workbench',
        abilities: {
          type: '',
          id: randomUUID().toUpperCase(),
          gen_video: {
            id: randomUUID().toUpperCase(),
            type: '',
            text_to_video_params: {
              type: '',
              id: randomUUID().toUpperCase(),
              model_req_key: modelReqKey,
              priority: 0,
              seed: Math.floor(Math.random() * 100000000) + 2500000000,
              video_aspect_ratio: ratio,
              video_gen_inputs: [
                {
                  duration_ms: duration * 1000,
                  first_frame_image: null,
                  end_frame_image: null,
                  fps: 24,
                  id: randomUUID().toUpperCase(),
                  min_version: '3.0.5',
                  prompt,
                  resolution,
                  type: '',
                  video_mode: 2,
                },
              ],
            },
            video_task_extra: metrics,
          },
        },
      },
    ],
  }

  const data = await call(
    cookie,
    'POST',
    '/mweb/v1/aigc_draft/generate',
    {
      extend: { root_model: modelReqKey, m_video_commerce_info: commerce, m_video_commerce_info_list: [commerce] },
      submit_id: randomUUID().toUpperCase(),
      metrics_extra: metrics,
      draft_content: JSON.stringify(draft),
      http_common_info: { aid: AID },
    },
    { aigc_features: 'app_lip_sync', web_version: WEB_VERSION, da_version: DRAFT_VERSION, web_component_open_flag: '1' },
  )
  const historyId = data?.aigc_data?.history_record_id
  if (historyId === undefined || historyId === null) throw new Error('即梦没有返回 history_record_id，提交未生效')
  return String(historyId)
}

/** Video URL inside one history record, if the task already produced it. */
function videoUrlOf(record) {
  for (const item of record?.item_list ?? []) {
    const video = item?.video ?? {}
    const url =
      video?.transcoded_video?.origin?.video_url ??
      video?.play_url ??
      video?.download_url ??
      video?.url
    if (typeof url === 'string' && url.length > 0) return url
  }
  return undefined
}

/**
 * Poll one submitted task until it finishes.
 * @returns the finished video URL.
 */
export async function pollVideo(cookie, historyId, { intervalMs = 5000, timeoutMs = 900000, signal, onTick } = {}) {
  const deadline = Date.now() + timeoutMs
  let status
  let lastFailCode
  while (Date.now() < deadline) {
    if (signal?.aborted === true) throw new Error('已取消')
    const data = await call(cookie, 'POST', '/mweb/v1/get_history_by_ids', { history_ids: [historyId] })
    const record = data?.[historyId] ?? data?.history_list?.[0]
    status = record?.task?.status ?? record?.status
    lastFailCode = record?.fail_code
    const url = videoUrlOf(record)
    onTick?.({ status, url })
    if (url !== undefined) return { url, status }
    if (STATUS_FAILED.has(status)) {
      throw new Error(`即梦生成失败 status=${status}${lastFailCode !== undefined ? ` fail_code=${lastFailCode}` : ''}`)
    }
    if (STATUS_DONE.has(status) && url === undefined) {
      throw new Error(`任务已结束但没有返回视频地址（status=${status}）`)
    }
    await new Promise((done) => setTimeout(done, intervalMs))
  }
  throw new Error(`等待超时（${Math.round(timeoutMs / 1000)} 秒），任务 ${historyId} 仍在 status=${status ?? '未知'}`)
}

/** Filesystem-safe name derived from the prompt. */
function slugify(prompt, maxLength = 40) {
  const cleaned = prompt
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return (cleaned.slice(0, maxLength) || 'seedance').toLowerCase()
}

/**
 * Download a finished video into the workspace.
 * @returns the absolute saved path.
 */
export async function downloadVideo(url, directory, { prompt = '', historyId = '' } = {}) {
  await mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const name = `${stamp}-${slugify(prompt)}${historyId !== '' ? `-${historyId}` : ''}.mp4`
  const target = join(directory, name)

  let response
  try {
    response = await fetch(url)
  } catch (error) {
    throw describeNetworkError('视频下载', error)
  }
  if (!response.ok) throw new Error(`下载视频失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('下载到的视频为空')
  await writeFile(target, buffer)
  return { path: target, bytes: buffer.length, fileName: basename(target, extname(target)) }
}
