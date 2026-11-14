# 即梦 Jimeng for DeepSeek Harness

把本机「即梦 AI」桌面端的账号直接接进 dsh —— 生图、生视频都能调，不用 API Key。

**模型列表是实时从账号读的**，不是写死的。今天有 Seedream 5.5、Seedance 2.5，明天出 6.0、3.0 也不用改插件。

## 四个工具

| 工具 | 作用 | 消耗积分 |
| --- | --- | --- |
| `jimeng_models` | 列出账号当前可用的全部生图 / 生视频模型 | ❌ |
| `jimeng_status` | 查登录态和余额 | ❌ |
| `jimeng_image` | 文生图，保存到工作区 | ✅ |
| `jimeng_video` | 文生视频，保存到工作区 | ✅ |

## 积分安全

这个插件对积分很克制，有四道闸：

1. **`dryRun`** —— 传 `dryRun: true` 只构建并返回请求载荷，**不提交、不扣费**。参数不确定时先这样试。
2. **`jimeng_status` / `jimeng_models`** —— 完全免费，随时查。
3. **`minCreditsToKeep`** —— 余额低于等于这个值就拒绝提交。比如设成 `50`，余额掉到 50 就自动停。
4. **`allowSpend`** —— 改成 `false` 后，所有花钱的工具直接拒绝，只剩查余额和列模型。

```yaml
- id: jimeng-seedance
  name: '@local/dsh-jimeng-seedance'
  config:
    minCreditsToKeep: 50    # 低于 50 不干活
    allowSpend: true        # 改成 false = 全面锁死
```

## 为什么模型不用写死

插件调的是网页端自己用的两个接口：

- `POST /mweb/v1/get_common_config` —— 生图模型
- `POST /mweb/v1/video_generate/get_common_config` —— 生视频模型

返回里带 `model_req_key`、`model_name`、`duration_option`、`video_aspect_ratio_option`、`feats`。插件把这些直接当数据用，所以：

- 新模型上线 → 自动出现在 `jimeng_models`
- 时长范围变了 → 自动跟着变
- 模型被下架 → 自动消失

不需要发版。

## 用法

```
先看看我账号能用哪些模型
```

```
用 Seedream 5.5 生成一张图：一只橘猫趴在窗台上晒太阳，水彩插画风格
```

```
生成一段 9:16 竖屏、10 秒的视频，城市夜景航拍，霓虹倒映在雨后街道
```

参数不确定时：

```
用 dryRun 试一下这个视频请求，别真跑
```

## 参数

### `jimeng_image`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `prompt` | 必填 | 画面描述 |
| `model` | 账号第一个生图模型 | 模型 key，如 `high_aes_general_v55` |
| `prefer` | — | 按名称挑，如 `Seedream 5.5` |
| `ratio` | `1:1` | `21:9` `16:9` `3:2` `4:3` `1:1` `3:4` `2:3` `9:16` |
| `count` | `1` | 生成张数 |
| `resolution` | `1k` | `1k` / `2k` / `4k`，取决于模型 |
| `download` | `true` | 是否存到工作区 |
| `dryRun` | `false` | 只构建请求，不提交 |

### `jimeng_video`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `prompt` | 必填 | 视频提示词 |
| `model` | 账号第一个生视频模型 | 如 `dreamina_seedance_45_pro` |
| `prefer` | — | 按名称挑，如 `Seedance 2.5` |
| `ratio` | 模型支持的第一个 | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` |
| `duration` | 模型允许的最短值 | 秒，范围由模型决定 |
| `resolution` | `720p` | |
| `download` | `true` | 是否存到工作区 |
| `dryRun` | `false` | 只构建请求，不提交 |

## 实现原理

桌面端是 Electron，登录态以明文 Cookie 存在：

```
%APPDATA%\dreamina-desktop\Partitions\dreamina-web\Network\Cookies
```

插件用 `node:sqlite` 读这个库取 `sessionid`，再按网页端规则签名：

```js
md5(`9e2c|${uri.slice(-7)}|7|5.8.0|${deviceTime}||11ac`)
```

带 `Device-Time` / `Sign` / `Sign-Ver` 头，伪装成 Chrome 142。

## 已知限制

- **即梦客户端运行时读不到 Cookies** —— 客户端会独占这个 SQLite 文件。两个办法：退出客户端再调用，或在配置里用 `cookieHeader` 手填。
- 只支持文生图 / 文生视频，图生视频（首帧/尾帧）还没接
- 一次只能跑一个任务
- 依赖桌面端 Cookie 的存储格式，即梦改了就得跟
- 接口非官方公开，随时可能变

## 配置项

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `cookieDbPath` | `''` | Cookie 库路径，留空自动探测 |
| `cookieHeader` | `''` | 手填 Cookie，填了就优先用它 |
| `downloadDir` | `jimeng-output` | 成片目录，相对工作区 |
| `pollIntervalMs` | `5000` | 轮询间隔 |
| `pollTimeoutMs` | `900000` | 最长等 15 分钟 |
| `minCreditsToKeep` | `0` | 余额保留下限 |
| `allowSpend` | `true` | 消耗总开关 |
