/**
 * Seedance video generation for DeepSeek Harness, driven by the signed-in
 * session of the Jimeng (即梦 AI) desktop app.
 *
 * Two tools:
 * - `seedance_generate` submits a text-to-video task, waits for it, and saves
 *   the finished MP4 into the session working directory.
 * - `seedance_status` reports the Jimeng account state (login, credits) so a
 *   failure is diagnosed before spending a generation.
 *
 * Tool definitions are written by hand rather than through `defineTool` so the
 * bundle needs no import from the Harness packages at runtime.
 *
 * @module @local/dsh-jimeng-seedance
 */

import { resolve } from 'node:path'

import {
  MODELS,
  MODEL_LIMITS,
  downloadVideo,
  findCookieDb,
  pollVideo,
  readCredit,
  readSessionCookie,
  submitVideo,
} from './lib/jimeng.js'

export const name = 'jimeng-seedance'

export const inject = ['tools']

/** Plugin config; every field has a working default. */
export const DEFAULT_CONFIG = {
  /** Absolute path to the desktop app's cookie database; empty = auto-detect. */
  cookieDbPath: '',
  /** Directory for finished clips, relative to the session working directory. */
  downloadDir: 'jimeng-videos',
  /** Poll interval while a task renders. */
  pollIntervalMs: 5000,
  /** Give up waiting after this long. */
  pollTimeoutMs: 900000,
}

/** Absolute cookie database path, resolved per call so a fresh login is picked up. */
function resolveCookieDb(config) {
  const dbPath = findCookieDb(config.cookieDbPath)
  if (dbPath === undefined) {
    throw new Error(
      '没有找到即梦桌面端的 Cookies 数据库。请确认已安装并登录「即梦 AI」客户端，或在插件配置里填写 cookieDbPath。',
    )
  }
  return dbPath
}

/** Session working directory, falling back to the host process directory. */
async function resolveWorkingDir(ctx, exec) {
  const service = ctx.get('workingDirectory')
  if (service !== undefined && exec?.agent !== undefined) {
    try {
      return await service.ensure(exec.agent, exec.signal)
    } catch {
      // fall through to the deployment default
    }
  }
  return service?.defaultDirectory ?? process.cwd()
}

function asRecord(value) {
  return typeof value === 'object' && value !== null ? value : {}
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Build the `seedance_generate` definition. */
function createGenerateTool(ctx, config) {
  return {
    name: 'seedance_generate',
    description:
      'Generate a video with Jimeng Seedance through the signed-in 即梦 AI desktop app, wait for it to finish, and save the MP4 into the workspace. Returns the saved path and the source URL.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '视频提示词，必填。中文效果最好：写清主体、动作、运镜、光线、风格。',
        },
        model: {
          type: 'string',
          enum: Object.keys(MODELS),
          description: '模型，可选。不填用 seedance-2.5（即梦 Seedance 2.5，支持 4-30 秒）。',
        },
        ratio: {
          type: 'string',
          enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
          description: '画面比例，可选，默认 16:9。竖屏短视频用 9:16。',
        },
        duration: {
          type: 'integer',
          description: '时长（秒），可选，默认 5。seedance-2.5 支持 4-30，2.0 系列支持 4-15。',
        },
        resolution: {
          type: 'string',
          enum: ['720p'],
          description: '分辨率，可选。网页端当前只开放 720p。',
        },
        download: {
          type: 'boolean',
          description: '是否把成片保存到工作区，可选，默认 true。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          historyId: { type: 'string', description: '即梦任务 id。' },
          model: { type: 'string', description: '实际使用的模型。' },
          ratio: { type: 'string', description: '实际画面比例。' },
          duration: { type: 'integer', description: '实际时长（秒）。' },
          url: { type: 'string', description: '成片地址。' },
          savedPath: { type: 'string', description: '本地保存路径。' },
          bytes: { type: 'integer', description: '文件大小（字节）。' },
        },
        required: ['historyId', 'model', 'ratio', 'duration', 'url'],
        additionalProperties: false,
      },
      render(_args, value) {
        const record = asRecord(value)
        const lines = [
          `Seedance ${record.model} · ${record.ratio} · ${record.duration}s · 任务 ${record.historyId}`,
          typeof record.savedPath === 'string' ? `已保存: ${record.savedPath}` : '已生成但未下载',
          `地址: ${record.url}`,
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: Math.max(config.pollTimeoutMs, 120000) + 120000,
    async execute(args, exec) {
      const record = asRecord(args)
      const prompt = asNonEmptyString(record.prompt)
      if (prompt === undefined) throw new Error('seedance_generate: 参数 prompt 必填，且必须是非空字符串。')

      const model = asNonEmptyString(record.model) ?? 'seedance-2.5'
      const limits = MODEL_LIMITS[model] ?? MODEL_LIMITS['seedance-2.5']
      const requestedRatio = asNonEmptyString(record.ratio)
      const ratio = limits.ratios.includes(requestedRatio) ? requestedRatio : '16:9'
      const requested = Number.isInteger(record.duration) ? record.duration : 5
      const duration = limits.durations.includes(requested) ? requested : limits.durations[0]
      const requestedResolution = asNonEmptyString(record.resolution)
      const resolution = limits.resolutions.includes(requestedResolution)
        ? requestedResolution
        : limits.resolutions[0]

      const cookie = await readSessionCookie(resolveCookieDb(config))

      const credit = await readCredit(cookie)
      if (credit.total <= 0) {
        throw new Error('即梦账号积分不足（VIP/赠送/购买均为 0），请先在即梦 AI 客户端充值。')
      }

      const historyId = await submitVideo(cookie, { prompt, model, ratio, duration, resolution })
      const { url } = await pollVideo(cookie, historyId, {
        intervalMs: config.pollIntervalMs,
        timeoutMs: config.pollTimeoutMs,
        signal: exec?.signal,
      })

      const value = { historyId, model, ratio, duration, url }
      if (record.download === false) return value

      const workingDir = await resolveWorkingDir(ctx, exec)
      const target = resolve(workingDir, config.downloadDir ?? 'jimeng-videos')
      const saved = await downloadVideo(url, target, { prompt, historyId })
      return { ...value, savedPath: saved.path, bytes: saved.bytes }
    },
  }
}

/** Build the `seedance_status` definition. */
function createStatusTool(config) {
  return {
    name: 'seedance_status',
    description:
      'Report the Jimeng desktop sign-in state and remaining credits used by seedance_generate. Use it when a generation fails or before spending credits.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          signedIn: { type: 'boolean', description: '桌面端登录态是否可用。' },
          cookieDbPath: { type: 'string', description: '读取的 Cookies 数据库路径。' },
          vipCredits: { type: 'integer', description: 'VIP 积分。' },
          giftCredits: { type: 'integer', description: '赠送积分。' },
          purchaseCredits: { type: 'integer', description: '购买积分。' },
          totalCredits: { type: 'integer', description: '可用积分合计。' },
          error: { type: 'string', description: '不可用时的原因。' },
        },
        required: ['signedIn', 'cookieDbPath'],
        additionalProperties: false,
      },
      render(_args, value) {
        const record = asRecord(value)
        if (record.signedIn !== true) {
          return [{
            type: 'text',
            text: `即梦桌面端未就绪: ${record.error ?? '未知原因'}\nCookies: ${record.cookieDbPath}`,
          }]
        }
        return [{
          type: 'text',
          text: [
            `已登录即梦桌面端 (${record.cookieDbPath})`,
            `积分: VIP ${record.vipCredits} · 赠送 ${record.giftCredits} · 购买 ${record.purchaseCredits} · 合计 ${record.totalCredits}`,
          ].join('\n'),
        }]
      },
    },
    timeoutMs: 30000,
    async execute() {
      let cookieDbPath = ''
      try {
        cookieDbPath = resolveCookieDb(config)
        const cookie = await readSessionCookie(cookieDbPath)
        const credit = await readCredit(cookie)
        return {
          signedIn: true,
          cookieDbPath,
          vipCredits: credit.vip,
          giftCredits: credit.gift,
          purchaseCredits: credit.purchase,
          totalCredits: credit.total,
        }
      } catch (error) {
        return {
          signedIn: false,
          cookieDbPath,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/** Register the Seedance tools. */
export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig ?? {}) }

  ctx.tools.register(createGenerateTool(ctx, config))
  ctx.tools.register(createStatusTool(config))

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'tool:seedance_generate',
      order: 900,
      text: 'seedance_generate 通过本机已登录的即梦 AI 桌面端出片，直接消耗账号积分；不确定额度时先用 seedance_status 查一次，再提交生成。',
    })
  }
}
