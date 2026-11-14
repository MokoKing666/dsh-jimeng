/**
 * Jimeng (即梦) web API client.
 *
 * Reuses the sign-in state of the installed Jimeng desktop app: its Electron
 * cookie jar stores the `jimeng.jianying.com` cookies in plaintext, so the
 * desktop session is read directly instead of asking for a token.
 *
 * The model catalog is **not** hard-coded. `fetchCatalog()` asks the web API
 * for the account's live model list, so new models (Seedream 5.x, Seedance 3.0,
 * Wan, Vidu, …) appear without a plugin update.
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
const IMAGE_DRAFT_VERSION = '3.0.2'

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

/** Terminal task statuses observed from `get_history_by_ids`. */
const STATUS_FAILED = new Set([30, 40])
const STATUS_DONE = new Set([21, 50])

/** Image aspect ratio → the numeric code and pixel size the web client sends. */
export const IMAGE_RATIOS = {
  '21:9': { code: 0, size: { width: 2016, height: 846 } },
  '16:9': { code: 1, size: { width: 1664, height: 936 } },
  '3:2': { code: 2, size: { width: 1584, height: 1056 } },
  '4:3': { code: 3, size: { width: 1472, height: 1104 } },
  '1:1': { code: 8, size: { width: 1328, height: 1328 } },
  '3:4': { code: 4, size: { width: 1104, height: 1472 } },
  '2:3': { code: 5, size: { width: 1056, height: 1584 } },
  '9:16': { code: 6, size: { width: 936, height: 1664 } },
}

/** Video aspect ratios the web client accepts. */
export const VIDEO_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

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

function buildCookieHeader(byName) {
  if (!byName.has('sessionid') && !byName.has('sid_tt')) {
    throw new Error('即梦桌面端尚未登录：Cookies 里没有 sessionid。请先打开即梦 AI 客户端并完成登录。')
  }
  return SESSION_COOKIES.filter((name) => byName.has(name))
    .map((name) => `${name}=${byName.get(name)}`)
    .join('; ')
}

function parseCookieString(text) {
  const byName = new Map()
  for (const part of text.split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const name = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (name !== '' && value !== '' && !byName.has(name)) byName.set(name, value)
  }
  return byName
}

/**
 * Read the Jimeng session cookies out of the desktop app's cookie jar.
 *
 * The running client holds this database open, so a read fails while the app
 * is up on Windows. `override` (a `Cookie` header pasted by the user) wins,
 * and is the escape hatch when the jar cannot be opened.
 *
 * @param dbPath - absolute path to the Electron `Cookies` SQLite database.
 * @param options.override - an explicit `Cookie` header, used as-is when set.
 * @returns the `Cookie` header value.
 */
export async function readSessionCookie(dbPath, { override } = {}) {
  if (typeof override === 'string' && override.trim() !== '') {
    return buildCookieHeader(parseCookieString(override))
  }

  const { DatabaseSync } = await import('node:sqlite')

  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const rows = db
          .prepare(`select name, value from cookies where host_key like '%jianying.com' and length(value) > 0`)
          .all()
        const byName = new Map()
        for (const row of rows) if (!byName.has(row.name)) byName.set(row.name, row.value)
        return buildCookieHeader(byName)
      } finally {
        db.close()
      }
    } catch (error) {
      lastError = error
      // A missing session is a real answer, not a transient lock.
      if (error instanceof Error && error.message.includes('尚未登录')) throw error
      if (attempt < 2) await new Promise((done) => setTimeout(done, 250 * (attempt + 1)))
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `读取即梦 Cookies 失败：${reason}。`
    + '即梦 AI 客户端运行时会把 Cookies 数据库独占，先退出客户端再调用即可；'
    + '或在插件配置里用 cookieHeader 直接指定 Cookie。',
  )
}

/** MD5 signature the web draft API requires on every call. */
function sign(uri, deviceTime) {
  return createHash('md5')
    .update(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${APP_VERSION}|${deviceTime}||11ac`)
    .digest('hex')
}

const WEB_ID = String(Math.floor(Math.random() * 1e18) + 7e18)

function describeNetworkError(uri, error) {
  const cause = error?.cause
  const detail = cause?.code ?? cause?.errno ?? cause?.message ?? error?.message ?? String(error)
  return new Error(`连接即梦接口失败（${uri}）：${detail}。请检查网络或代理设置后重试。`)
}

async function send(cookie, method, uri, body, query, referer, attempt = 0) {
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
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      },
      body,
    })
    return await response.text()
  } catch (error) {
    if (attempt < 2) {
      await new Promise((done) => setTimeout(done, 800 * (attempt + 1)))
      return send(cookie, method, uri, body, query, referer, attempt + 1)
    }
    throw describeNetworkError(uri, error)
  }
}

async function call(cookie, method, uri, data, extraParams = {}, referer = `${ORIGIN}/ai-tool/home`) {
  const query = new URLSearchParams({
    aid: String(AID),
    device_platform: 'web',
    region: 'CN',
    webId: WEB_ID,
    ...extraParams,
  }).toString()
  const text = await send(cookie, method, uri, data === undefined ? undefined : JSON.stringify(data), query, referer)
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

/** Remaining credits. */
export async function readCredit(cookie) {
  const data = await call(cookie, 'POST', '/commerce/v1/benefits/user_credit', {})
  const credit = data?.credit ?? {}
  const vip = Number(credit.vip_credit ?? 0)
  const gift = Number(credit.gift_credit ?? 0)
  const purchase = Number(credit.purchase_credit ?? 0)
  return { vip, gift, purchase, total: vip + gift + purchase }
}

/** Walk any JSON value collecting objects that declare a `model_req_key`. */
function collectModelNodes(value, out = []) {
  if (value === null || typeof value !== 'object') return out
  if (typeof value.model_req_key === 'string') out.push(value)
  for (const child of Object.values(value)) collectModelNodes(child, out)
  return out
}

/** Normalize one server model node into the shape the tools consume. */
function normalizeModel(node, kind) {
  const name = node.model_name ?? node.name ?? node.title ?? ''
  const tip = node.model_tip ?? node.description ?? node.desc ?? ''
  const durations = Array.isArray(node.duration_option) ? node.duration_option.filter(Number.isInteger) : []
  const ratios = Array.isArray(node.video_aspect_ratio_option) && node.video_aspect_ratio_option.length > 0
    ? node.video_aspect_ratio_option
    : VIDEO_RATIOS
  return {
    key: node.model_req_key,
    kind,
    name: typeof name === 'string' ? name.trim() : '',
    tip: typeof tip === 'string' ? tip.trim() : '',
    durations,
    ratios,
    /** Reference-image support, from the model's own feature flags. */
    supportsReference: Array.isArray(node.feats)
      ? node.feats.includes('support_first_image') || node.feats.includes('support_end_image')
      : false,
  }
}

/**
 * Fetch the live model catalog for this account.
 *
 * Uses the same two endpoints the web client calls, so whatever the account
 * can use — including models released after this plugin — shows up here.
 *
 * @returns `{ images, videos }`, each an array of normalized models.
 */
export async function fetchCatalog(cookie, { refresh = false } = {}) {
  const commonParams = {
    web_version: WEB_VERSION,
    da_version: DRAFT_VERSION,
    aigc_features: 'app_lip_sync',
  }

  const [imageResult, videoResult] = await Promise.allSettled([
    call(
      cookie,
      'POST',
      '/mweb/v1/get_common_config',
      { is_client_filter: false, need_beta_model: true },
      { ...commonParams, needCache: String(!refresh), needRefresh: String(refresh) },
      `${ORIGIN}/ai-tool/image/generate`,
    ),
    call(
      cookie,
      'POST',
      '/mweb/v1/video_generate/get_common_config',
      { scene: 'generate_video', params: { needCache: !refresh, needRefresh: refresh } },
      commonParams,
      `${ORIGIN}/ai-tool/video/generate`,
    ),
  ])

  const unique = (nodes, kind) => {
    const byKey = new Map()
    for (const node of nodes) {
      if (typeof node.model_req_key !== 'string' || node.model_req_key === '') continue
      if (!byKey.has(node.model_req_key)) byKey.set(node.model_req_key, normalizeModel(node, kind))
    }
    return [...byKey.values()]
  }

  const images = imageResult.status === 'fulfilled'
    ? unique(collectModelNodes(imageResult.value), 'image')
    : []
  const videos = videoResult.status === 'fulfilled'
    ? unique(collectModelNodes(videoResult.value), 'video')
    : []

  if (images.length === 0 && videos.length === 0) {
    const reason = [imageResult, videoResult]
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason?.message ?? String(r.reason))
      .join(' / ')
    throw new Error(`没能从即梦拿到模型列表${reason !== '' ? `：${reason}` : ''}`)
  }

  return { images, videos }
}

/**
 * Resolve the model to use: an explicit key wins, otherwise the first model
 * whose name matches `prefer` (case-insensitive substring), otherwise the
 * first model in the catalog.
 */
export function pickModel(models, { key, prefer } = {}) {
  if (models.length === 0) return undefined
  if (typeof key === 'string' && key.trim() !== '') {
    const exact = models.find((model) => model.key === key.trim())
    if (exact !== undefined) return exact
    const loose = models.find((model) => model.key.toLowerCase() === key.trim().toLowerCase())
    if (loose !== undefined) return loose
    throw new Error(
      `没有模型 ${key}。当前可用：${models.map((model) => model.key).join(', ')}`,
    )
  }
  if (typeof prefer === 'string' && prefer.trim() !== '') {
    const wanted = prefer.trim().toLowerCase()
    const byName = models.find((model) => model.name.toLowerCase().includes(wanted))
      ?? models.find((model) => model.key.toLowerCase().includes(wanted))
    if (byName !== undefined) return byName
  }
  return models[0]
}

/** Submit one text-to-video task. @returns the history record id. */
export async function submitVideo(cookie, { prompt, model, ratio, duration, resolution = '720p' }) {
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
              model_req_key: model,
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
      extend: { root_model: model, m_video_commerce_info: commerce, m_video_commerce_info_list: [commerce] },
      submit_id: randomUUID().toUpperCase(),
      metrics_extra: metrics,
      draft_content: JSON.stringify(draft),
      http_common_info: { aid: AID },
    },
    { aigc_features: 'app_lip_sync', web_version: WEB_VERSION, da_version: DRAFT_VERSION, web_component_open_flag: '1' },
    `${ORIGIN}/ai-tool/video/generate`,
  )
  const historyId = data?.aigc_data?.history_record_id
  if (historyId === undefined || historyId === null) throw new Error('即梦没有返回 history_record_id，提交未生效')
  return String(historyId)
}

/** Submit one text-to-image task. @returns the history record id. */
export async function submitImage(cookie, { prompt, model, ratio = '1:1', count = 1, resolution = '1k' }) {
  const shape = IMAGE_RATIOS[ratio] ?? IMAGE_RATIOS['1:1']
  const componentId = randomUUID().toUpperCase()
  const submitId = randomUUID().toUpperCase()

  const abilities = {
    type: '',
    id: randomUUID().toUpperCase(),
    generate: {
      type: '',
      id: randomUUID().toUpperCase(),
      core_param: {
        type: '',
        id: randomUUID().toUpperCase(),
        model,
        prompt,
        negative_prompt: '',
        seed: Math.floor(Math.random() * 100000000) + 2500000000,
        sample_strength: 0.5,
        image_ratio: shape.code,
        large_image_info: {
          type: '',
          id: randomUUID().toUpperCase(),
          height: shape.size.height,
          width: shape.size.width,
          resolution_type: resolution,
        },
        generate_type: 0,
      },
      history_option: { type: '', id: randomUUID().toUpperCase() },
    },
    gen_option: { type: '', id: randomUUID().toUpperCase(), gen_count: count, generate_all: false },
  }

  const data = await call(
    cookie,
    'POST',
    '/mweb/v1/aigc_draft/generate',
    {
      extend: { root_model: model },
      submit_id: submitId,
      metrics_extra: JSON.stringify({
        promptSource: 'custom',
        generateCount: count,
        enterFrom: 'click',
        sceneOptions: JSON.stringify([
          { type: 'image', scene: 'ImageBasicGenerate', modelReqKey: model, resolutionType: resolution, abilityList: [], benefitCount: count },
        ]),
        isBoxSelect: false,
        isCutout: false,
        generateId: submitId,
        isRegenerate: false,
      }),
      draft_content: JSON.stringify({
        type: 'draft',
        id: randomUUID().toUpperCase(),
        min_version: IMAGE_DRAFT_VERSION,
        min_features: [],
        is_from_tsn: true,
        version: IMAGE_DRAFT_VERSION,
        main_component_id: componentId,
        component_list: [
          {
            type: 'image_base_component',
            id: componentId,
            min_version: IMAGE_DRAFT_VERSION,
            metadata: {
              type: '',
              id: randomUUID().toUpperCase(),
              created_platform: 3,
              created_platform_version: '',
              created_time_in_ms: String(Date.now()),
              created_did: '',
            },
            generate_type: 'generate',
            aigc_mode: 'workbench',
            gen_type: 1,
            abilities,
          },
        ],
      }),
      http_common_info: { aid: AID },
    },
    { da_version: IMAGE_DRAFT_VERSION, web_component_open_flag: '1', web_version: WEB_VERSION },
    `${ORIGIN}/ai-tool/image/generate`,
  )
  const historyId = data?.aigc_data?.history_record_id
  if (historyId === undefined || historyId === null) throw new Error('即梦没有返回 history_record_id，提交未生效')
  return String(historyId)
}

/** Every image URL inside one history record. */
function imageUrlsOf(record) {
  const urls = []
  for (const item of record?.item_list ?? []) {
    const image = item?.image ?? {}
    for (const candidate of image.large_images ?? []) {
      if (typeof candidate?.url === 'string') urls.push(candidate.url)
    }
    if (typeof image.url === 'string') urls.push(image.url)
    if (typeof item?.common_attr?.cover_url === 'string') urls.push(item.common_attr.cover_url)
  }
  return [...new Set(urls)]
}

/** Video URL inside one history record, if the task already produced it. */
function videoUrlOf(record) {
  for (const item of record?.item_list ?? []) {
    const video = item?.video ?? {}
    const url =
      video?.transcoded_video?.origin?.video_url
      ?? video?.play_url
      ?? video?.download_url
      ?? video?.url
    if (typeof url === 'string' && url.length > 0) return url
  }
  return undefined
}

/**
 * Poll one submitted task until it finishes.
 * @returns the finished asset (a video URL, or image URLs).
 */
export async function pollTask(cookie, historyId, { kind, intervalMs = 5000, timeoutMs = 900000, signal } = {}) {
  const deadline = Date.now() + timeoutMs
  let status
  let lastFailCode
  while (Date.now() < deadline) {
    if (signal?.aborted === true) throw new Error('已取消')
    const data = await call(cookie, 'POST', '/mweb/v1/get_history_by_ids', { history_ids: [historyId] })
    const record = data?.[historyId] ?? data?.history_list?.[0]
    status = record?.task?.status ?? record?.status
    lastFailCode = record?.fail_code

    if (kind === 'image') {
      const urls = imageUrlsOf(record)
      if (urls.length > 0) return { images: urls, status }
    } else {
      const url = videoUrlOf(record)
      if (url !== undefined) return { url, status }
    }

    if (STATUS_FAILED.has(status)) {
      throw new Error(`即梦生成失败 status=${status}${lastFailCode !== undefined ? ` fail_code=${lastFailCode}` : ''}`)
    }
    if (STATUS_DONE.has(status)) {
      throw new Error(`任务已结束但没有返回${kind === 'image' ? '图片' : '视频'}地址（status=${status}）`)
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
  return (cleaned.slice(0, maxLength) || 'jimeng').toLowerCase()
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

/**
 * Download a finished asset into the workspace.
 * @returns the absolute saved path and byte size.
 */
export async function downloadAsset(url, directory, { prompt = '', historyId = '', index, ext = 'mp4' } = {}) {
  await mkdir(directory, { recursive: true })
  const suffix = index === undefined ? '' : `-${index + 1}`
  const name = `${stamp()}-${slugify(prompt)}${historyId !== '' ? `-${historyId}` : ''}${suffix}.${ext}`
  const target = join(directory, name)

  let response
  try {
    response = await fetch(url)
  } catch (error) {
    throw describeNetworkError('资源下载', error)
  }
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('下载到的文件为空')
  await writeFile(target, buffer)
  return { path: target, bytes: buffer.length, fileName: basename(target, extname(target)) }
}
