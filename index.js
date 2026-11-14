/**
 * Jimeng (即梦 AI) for DeepSeek Harness.
 *
 * Exposes the account's full Jimeng capability — image generation and video
 * generation — through the signed-in desktop app, with no API key. The model
 * catalog is read from the live account, so models released after this plugin
 * work without an update.
 *
 * Tools:
 * - `jimeng_models`   list what this account can actually use (free)
 * - `jimeng_status`   sign-in state and remaining credits (free)
 * - `jimeng_image`    text-to-image (spends credits)
 * - `jimeng_video`    text-to-video (spends credits)
 *
 * Every spending tool supports `dryRun`, which builds and returns the exact
 * request without submitting it. Use it to validate a call for free.
 *
 * Tool definitions are written by hand rather than through `defineTool` so the
 * bundle needs no import from the Harness packages at runtime.
 *
 * @module @local/dsh-jimeng-seedance
 */

import { resolve } from 'node:path'

import {
  IMAGE_RATIOS,
  VIDEO_RATIOS,
  downloadAsset,
  fetchCatalog,
  findCookieDb,
  pickModel,
  pollTask,
  readCredit,
  readSessionCookie,
  submitImage,
  submitVideo,
} from './lib/jimeng.js'

export const name = 'jimeng-seedance'

export const inject = ['tools']

/** Plugin config; every field has a working default. */
export const DEFAULT_CONFIG = {
  /** Absolute path to the desktop app's cookie database; empty = auto-detect. */
  cookieDbPath: '',
  /** A `Cookie` header pasted by hand; used instead of the cookie database. */
  cookieHeader: '',
  /** Directory for finished assets, relative to the session working directory. */
  downloadDir: 'jimeng-output',
  /** Poll interval while a task renders. */
  pollIntervalMs: 5000,
  /** Give up waiting after this long. */
  pollTimeoutMs: 900000,
  /** Refuse to start a generation when the balance would fall below this. */
  minCreditsToKeep: 0,
  /** Hard stop: when false, every spending tool refuses and only dryRun works. */
  allowSpend: true,
}

function asRecord(value) {
  return typeof value === 'object' && value !== null ? value : {}
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Absolute cookie database path, resolved per call so a fresh login is picked up. */
function resolveCookieDb(config) {
  if (typeof config.cookieHeader === 'string' && config.cookieHeader.trim() !== '') return ''
  const dbPath = findCookieDb(config.cookieDbPath)
  if (dbPath === undefined) {
    throw new Error(
      '没有找到即梦桌面端的 Cookies 数据库。请确认已安装「即梦 AI」客户端，'
      + '或在插件配置里填写 cookieDbPath / cookieHeader。',
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

/** Read the session cookie using config, honoring a manual override. */
function readCookie(config) {
  return readSessionCookie(resolveCookieDb(config), { override: config.cookieHeader })
}

/**
 * Refuse to spend when the account is short, so a call fails before it costs
 * anything. `minCreditsToKeep` is a floor the user sets.
 */
async function guardSpend(config, cookie) {
  if (config.allowSpend === false) {
    throw new Error('插件配置 allowSpend 为 false，已禁止消耗积分的调用。改用 dryRun 检查请求，或把 allowSpend 设为 true。')
  }
  const credit = await readCredit(cookie)
  if (credit.total <= 0) {
    throw new Error('即梦账号积分不足（VIP/赠送/购买均为 0），请先在即梦 AI 客户端充值。')
  }
  const floor = Number(config.minCreditsToKeep ?? 0)
  if (Number.isFinite(floor) && floor > 0 && credit.total <= floor) {
    throw new Error(`当前积分 ${credit.total}，已触及保留下限 ${floor}，本次不提交。`)
  }
  return credit
}

/* ------------------------------------------------------------------ */
/* Model listing                                                       */
/* ------------------------------------------------------------------ */

function createModelsTool(config) {
  return {
    name: 'jimeng_models',
    description:
      'List the image and video models this Jimeng account can use, read live from the account. Free — never spends credits. Use it before generating to see current model ids and their supported durations and aspect ratios.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['all', 'image', 'video'],
          description: 'Which catalog to return. Defaults to all.',
        },
        refresh: {
          type: 'boolean',
          description: 'Bypass the server-side cache. Defaults to false.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                name: { type: 'string' },
                tip: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          videos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                kind: { type: 'string' },
                name: { type: 'string' },
                tip: { type: 'string' },
                durations: { type: 'array', items: { type: 'integer' } },
                ratios: { type: 'array', items: { type: 'string' } },
                supportsReference: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      render(_args, value) {
        const record = asRecord(value)
        const lines = []
        const images = Array.isArray(record.images) ? record.images : []
        const videos = Array.isArray(record.videos) ? record.videos : []
        if (images.length > 0) {
          lines.push(`生图模型（${images.length}）`)
          for (const model of images) {
            const label = model.name !== '' ? `${model.name} — ` : ''
            lines.push(`- ${model.key}  ${label}${model.tip ?? ''}`)
          }
        }
        if (videos.length > 0) {
          if (lines.length > 0) lines.push('')
          lines.push(`生视频模型（${videos.length}）`)
          for (const model of videos) {
            const label = model.name !== '' ? `${model.name} — ` : ''
            const span = Array.isArray(model.durations) && model.durations.length > 0
              ? ` [${model.durations[0]}-${model.durations[model.durations.length - 1]}s]`
              : ''
            lines.push(`- ${model.key}  ${label}${model.tip ?? ''}${span}`)
          }
        }
        return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '账号没有返回任何模型。' }]
      },
    },
    timeoutMs: 45000,
    async execute(args) {
      const record = asRecord(args)
      const cookie = await readCookie(config)
      const catalog = await fetchCatalog(cookie, { refresh: record.refresh === true })
      const kind = asNonEmptyString(record.kind) ?? 'all'
      const strip = (models) => models.map(({ key, name, tip }) => ({ key, name, tip }))
      const videoModels = catalog.videos.map((model) => ({
        key: model.key,
        kind: model.kind,
        name: model.name,
        tip: model.tip,
        durations: model.durations,
        ratios: model.ratios,
        supportsReference: model.supportsReference,
      }))
      return {
        images: kind === 'video' ? [] : strip(catalog.images),
        videos: kind === 'image' ? [] : videoModels,
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function createStatusTool(config) {
  return {
    name: 'jimeng_status',
    description:
      'Report the Jimeng desktop sign-in state and remaining credits. Free — never spends credits. Use it before a generation, or when one fails.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          signedIn: { type: 'boolean', description: '登录态是否可用。' },
          cookieDbPath: { type: 'string', description: '读取的 Cookies 路径，手动 Cookie 时为空。' },
          vipCredits: { type: 'integer' },
          giftCredits: { type: 'integer' },
          purchaseCredits: { type: 'integer' },
          totalCredits: { type: 'integer' },
          allowSpend: { type: 'boolean' },
          minCreditsToKeep: { type: 'integer' },
          error: { type: 'string' },
        },
        required: ['signedIn', 'cookieDbPath', 'allowSpend', 'minCreditsToKeep'],
        additionalProperties: false,
      },
      render(_args, value) {
        const record = asRecord(value)
        if (record.signedIn !== true) {
          return [{
            type: 'text',
            text: `即梦未就绪：${record.error ?? '未知原因'}\nCookies: ${record.cookieDbPath || '（手动 Cookie）'}`,
          }]
        }
        const spend = record.allowSpend === true ? '允许消耗' : '已禁止消耗'
        return [{
          type: 'text',
          text: [
            `已登录即梦${record.cookieDbPath ? `（${record.cookieDbPath}）` : '（手动 Cookie）'}`,
            `积分：VIP ${record.vipCredits} · 赠送 ${record.giftCredits} · 购买 ${record.purchaseCredits} · 合计 ${record.totalCredits}`,
            `出片策略：${spend}，保留下限 ${record.minCreditsToKeep}`,
          ].join('\n'),
        }]
      },
    },
    timeoutMs: 30000,
    async execute() {
      let cookieDbPath = ''
      try {
        cookieDbPath = resolveCookieDb(config)
        const cookie = await readCookie(config)
        const credit = await readCredit(cookie)
        return {
          signedIn: true,
          cookieDbPath,
          vipCredits: credit.vip,
          giftCredits: credit.gift,
          purchaseCredits: credit.purchase,
          totalCredits: credit.total,
          allowSpend: config.allowSpend !== false,
          minCreditsToKeep: Number(config.minCreditsToKeep ?? 0),
        }
      } catch (error) {
        return {
          signedIn: false,
          cookieDbPath,
          allowSpend: config.allowSpend !== false,
          minCreditsToKeep: Number(config.minCreditsToKeep ?? 0),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Image generation                                                    */
/* ------------------------------------------------------------------ */

function createImageTool(ctx, config) {
  return {
    name: 'jimeng_image',
    description:
      'Generate images with Jimeng through the signed-in desktop app and save them into the workspace. Spends credits unless dryRun is true. Use jimeng_models to see current image model ids.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述，必填。中文效果最好。' },
        model: { type: 'string', description: '模型 key，可选。不填用账号里排第一的生图模型。' },
        prefer: { type: 'string', description: '按名称挑选模型的关键词，如 "Seedream 5.0"。model 优先。' },
        ratio: {
          type: 'string',
          enum: Object.keys(IMAGE_RATIOS),
          description: '画面比例，可选，默认 1:1。',
        },
        count: { type: 'integer', description: '生成张数，可选，默认 1。' },
        resolution: {
          type: 'string',
          enum: ['1k', '2k', '4k'],
          description: '分辨率档位，可选，默认 1k。具体支持范围取决于模型。',
        },
        download: { type: 'boolean', description: '是否保存到工作区，默认 true。' },
        dryRun: {
          type: 'boolean',
          description: '只构建并返回请求，不提交、不消耗积分。默认 false。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: '实际使用的模型 key。' },
          modelName: { type: 'string' },
          ratio: { type: 'string' },
          count: { type: 'integer' },
          dryRun: { type: 'boolean' },
          historyId: { type: 'string' },
          urls: { type: 'array', items: { type: 'string' } },
          savedPaths: { type: 'array', items: { type: 'string' } },
          bytes: { type: 'array', items: { type: 'integer' } },
          creditsBefore: { type: 'integer' },
          request: { type: 'string', description: 'dryRun 时的完整请求载荷。' },
        },
        required: ['model', 'ratio', 'count', 'dryRun'],
        additionalProperties: false,
      },
      render(_args, value) {
        const record = asRecord(value)
        const head = `即梦生图 · ${record.modelName || record.model} · ${record.ratio} · ${record.count} 张`
        if (record.dryRun === true) {
          return [{ type: 'text', text: `${head}\n[dryRun] 未提交，未消耗积分。请求载荷：\n${record.request ?? ''}` }]
        }
        const paths = Array.isArray(record.savedPaths) ? record.savedPaths : []
        const urls = Array.isArray(record.urls) ? record.urls : []
        const lines = [head, `任务 ${record.historyId ?? ''}`]
        if (paths.length > 0) for (const path of paths) lines.push(`已保存: ${path}`)
        else for (const url of urls) lines.push(`地址: ${url}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: Math.max(config.pollTimeoutMs, 120000) + 120000,
    async execute(args, exec) {
      const record = asRecord(args)
      const prompt = asNonEmptyString(record.prompt)
      if (prompt === undefined) throw new Error('jimeng_image: 参数 prompt 必填，且必须是非空字符串。')

      const ratio = IMAGE_RATIOS[record.ratio] !== undefined ? record.ratio : '1:1'
      const count = Number.isInteger(record.count) && record.count > 0 ? record.count : 1
      const resolution = ['1k', '2k', '4k'].includes(record.resolution) ? record.resolution : '1k'

      const cookie = await readCookie(config)
      const catalog = await fetchCatalog(cookie)
      const model = pickModel(catalog.images, { key: record.model, prefer: record.prefer })
      if (model === undefined) throw new Error('账号没有返回任何可用的生图模型。')

      const plan = { prompt, model: model.key, ratio, count, resolution }

      if (record.dryRun === true) {
        return {
          model: model.key,
          modelName: model.name,
          ratio,
          count,
          dryRun: true,
          request: JSON.stringify(plan),
        }
      }

      const credit = await guardSpend(config, cookie)
      const historyId = await submitImage(cookie, plan)
      const { images } = await pollTask(cookie, historyId, {
        kind: 'image',
        intervalMs: config.pollIntervalMs,
        timeoutMs: config.pollTimeoutMs,
        signal: exec?.signal,
      })

      const value = {
        model: model.key,
        modelName: model.name,
        ratio,
        count,
        dryRun: false,
        historyId,
        urls: images,
        creditsBefore: credit.total,
      }
      if (record.download === false) return value

      const workingDir = await resolveWorkingDir(ctx, exec)
      const target = resolve(workingDir, config.downloadDir ?? 'jimeng-output')
      const saved = []
      const sizes = []
      for (const [index, url] of images.entries()) {
        const result = await downloadAsset(url, target, { prompt, historyId, index, ext: 'png' })
        saved.push(result.path)
        sizes.push(result.bytes)
      }
      return { ...value, savedPaths: saved, bytes: sizes }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Video generation                                                    */
/* ------------------------------------------------------------------ */

function createVideoTool(ctx, config) {
  return {
    name: 'jimeng_video',
    description:
      'Generate a video with Jimeng through the signed-in desktop app, wait for it, and save the MP4 into the workspace. Spends credits unless dryRun is true. Use jimeng_models to see current video model ids and their duration ranges.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频提示词，必填。中文效果最好：主体、动作、运镜、光线、风格。' },
        model: { type: 'string', description: '模型 key，可选。不填用账号里排第一的生视频模型。' },
        prefer: { type: 'string', description: '按名称挑选模型的关键词，如 "Seedance 2.5"。model 优先。' },
        ratio: {
          type: 'string',
          enum: VIDEO_RATIOS,
          description: '画面比例，可选，默认 16:9。竖屏用 9:16。',
        },
        duration: { type: 'integer', description: '时长（秒），可选。不填取该模型允许的最短值。' },
        resolution: { type: 'string', description: '分辨率，可选，默认 720p。' },
        download: { type: 'boolean', description: '是否保存到工作区，默认 true。' },
        dryRun: {
          type: 'boolean',
          description: '只构建并返回请求，不提交、不消耗积分。默认 false。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          modelName: { type: 'string' },
          ratio: { type: 'string' },
          duration: { type: 'integer' },
          dryRun: { type: 'boolean' },
          historyId: { type: 'string' },
          url: { type: 'string' },
          savedPath: { type: 'string' },
          bytes: { type: 'integer' },
          creditsBefore: { type: 'integer' },
          request: { type: 'string' },
        },
        required: ['model', 'ratio', 'duration', 'dryRun'],
        additionalProperties: false,
      },
      render(_args, value) {
        const record = asRecord(value)
        const head = `即梦生视频 · ${record.modelName || record.model} · ${record.ratio} · ${record.duration}s`
        if (record.dryRun === true) {
          return [{ type: 'text', text: `${head}\n[dryRun] 未提交，未消耗积分。请求载荷：\n${record.request ?? ''}` }]
        }
        const lines = [head, `任务 ${record.historyId ?? ''}`]
        if (typeof record.savedPath === 'string') lines.push(`已保存: ${record.savedPath}`)
        else lines.push('已生成但未下载')
        if (typeof record.url === 'string') lines.push(`地址: ${record.url}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: Math.max(config.pollTimeoutMs, 120000) + 120000,
    async execute(args, exec) {
      const record = asRecord(args)
      const prompt = asNonEmptyString(record.prompt)
      if (prompt === undefined) throw new Error('jimeng_video: 参数 prompt 必填，且必须是非空字符串。')

      const cookie = await readCookie(config)
      const catalog = await fetchCatalog(cookie)
      const model = pickModel(catalog.videos, { key: record.model, prefer: record.prefer })
      if (model === undefined) throw new Error('账号没有返回任何可用的生视频模型。')

      const ratio = model.ratios.includes(record.ratio) ? record.ratio : (model.ratios[0] ?? '16:9')
      const allowed = model.durations.length > 0 ? model.durations : [5]
      const requested = Number.isInteger(record.duration) ? record.duration : allowed[0]
      const duration = allowed.includes(requested) ? requested : allowed[0]
      const resolution = asNonEmptyString(record.resolution) ?? '720p'

      const plan = { prompt, model: model.key, ratio, duration, resolution }

      if (record.dryRun === true) {
        return {
          model: model.key,
          modelName: model.name,
          ratio,
          duration,
          dryRun: true,
          request: JSON.stringify(plan),
        }
      }

      const credit = await guardSpend(config, cookie)
      const historyId = await submitVideo(cookie, plan)
      const { url } = await pollTask(cookie, historyId, {
        kind: 'video',
        intervalMs: config.pollIntervalMs,
        timeoutMs: config.pollTimeoutMs,
        signal: exec?.signal,
      })

      const value = {
        model: model.key,
        modelName: model.name,
        ratio,
        duration,
        dryRun: false,
        historyId,
        url,
        creditsBefore: credit.total,
      }
      if (record.download === false) return value

      const workingDir = await resolveWorkingDir(ctx, exec)
      const target = resolve(workingDir, config.downloadDir ?? 'jimeng-output')
      const saved = await downloadAsset(url, target, { prompt, historyId, ext: 'mp4' })
      return { ...value, savedPath: saved.path, bytes: saved.bytes }
    },
  }
}

/** Register the Jimeng tools. */
export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig ?? {}) }

  ctx.tools.register(createModelsTool(config))
  ctx.tools.register(createStatusTool(config))
  ctx.tools.register(createImageTool(ctx, config))
  ctx.tools.register(createVideoTool(ctx, config))

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'tool:jimeng',
      order: 900,
      text: 'jimeng_image 与 jimeng_video 会真实消耗即梦账号积分。'
        + '先用 jimeng_models 确认可用模型、用 jimeng_status 看余额；'
        + '不确定参数时先带 dryRun 跑一次（不消耗积分），确认无误再去掉 dryRun 提交。',
    })
  }
}
