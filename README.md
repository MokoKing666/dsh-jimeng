<div align="center">

<img src="icon.svg" width="96" height="96" alt="dsh-jimeng">

# dsh-jimeng

**把本机已登录的「即梦 AI」桌面端接进 DeepSeek Harness —— 生图、生视频都能调，不用 API Key。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4c6ef5)](https://github.com/deepseek-ai)
[![Jimeng](https://img.shields.io/badge/即梦-Seedream%20%7C%20Seedance-ff6b6b)](https://jimeng.jianying.com)
[![Models](https://img.shields.io/badge/模型列表-实时读取-success)](#为什么模型不用写死)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)]()

[功能](#功能) · [积分安全](#积分安全) · [安装](#安装) · [用法](#用法) · [实现原理](#实现原理) · [English](README.en.md)

<img src="docs/preview.jpg" width="720" alt="即梦生成样片">

<sub>这一帧来自本插件真实生成的 Seedance 2.5 视频（4 秒 / 16:9 / 720p）</sub>

</div>

---

## 这是什么

一个 **DeepSeek Harness 插件（bundle）**，把即梦账号的生成能力接进对话。

不是只接 Seedance。你账号里能用什么，插件就能调什么：

**生图 16 个模型** —— Seedream 5.5 / 5.0 Pro / 5.0 Aurora / 5.0 Surge / 5.0 Flash / 5.0 Lite、即梦 ImageMax 1.0、图片美学模型 V8.2、Anycook 1.0、Seedream 4.7 / 4.6 / 4.5 / 4.1 / 4.0 / 3.1 / 3.0

**生视频 18 个模型** —— Seedance 2.5 / 2.5 Flash / 2.5 样片模式、Seedance 2.0 全系、Seedance 1.0、Wan 3.0 / 3.0 Prime、Vidu Q3 / Q2、HappyHorse 1.1 / 1.0

> 上面这份清单是**实时从账号读出来的**，不是写死的。你的账号等级不同、即梦上新模型，列表自动跟着变。

| 工具 | 作用 | 消耗积分 |
| --- | --- | --- |
| `jimeng_models` | 列出账号当前可用的全部模型 | ❌ 免费 |
| `jimeng_status` | 查登录态和余额 | ❌ 免费 |
| `jimeng_image` | 文生图，保存到工作区 | ✅ |
| `jimeng_video` | 文生视频，保存到工作区 | ✅ |

---

## 积分安全

生成会真实扣费，所以插件有四道闸：

| 闸 | 怎么用 | 效果 |
| --- | --- | --- |
| **`dryRun`** | 任何生成工具加 `dryRun: true` | 只构建并返回请求载荷，**不提交、不扣费** |
| **免费工具** | `jimeng_models` / `jimeng_status` | 查模型、查余额，一分不花 |
| **`minCreditsToKeep`** | 配置成 `50` | 余额 ≤ 50 就拒绝提交 |
| **`allowSpend`** | 配置成 `false` | 所有花钱的工具直接拒绝，只剩查询 |

**推荐的用法**：参数不确定时先 `dryRun`，确认载荷对了再去掉。

```yaml
- id: jimeng-seedance
  name: '@local/dsh-jimeng-seedance'
  config:
    minCreditsToKeep: 50    # 低于 50 不干活
    allowSpend: true        # 改成 false = 全面锁死
```

---

## 安装

### 前置条件

1. **DeepSeek Harness** 0.2.x
2. 本机安装并**登录**了 [即梦 AI 桌面客户端](https://jimeng.jianying.com)
3. 账号有可用积分
4. Node.js ≥ 22.5（`node:sqlite` 内置模块要求；DSH 自带 Node 24 已满足）

### 一条命令

```bash
git clone https://github.com/MokoKing666/dsh-jimeng.git
cd dsh-jimeng
dsh plugin --profile desktop add .
```

也可以在 dsh 的 **Plugins** 页面点 **Add plugin** 选本地目录。

> 装完工具没出现就重启一次 dsh。

---

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

不确定参数时：

```
用 dryRun 试一下这个视频请求，别真跑
```

### `jimeng_image`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `prompt` | 必填 | 画面描述 |
| `model` | 账号第一个生图模型 | 如 `high_aes_general_v55` |
| `prefer` | — | 按名称挑，如 `Seedream 5.5` |
| `ratio` | `1:1` | `21:9` `16:9` `3:2` `4:3` `1:1` `3:4` `2:3` `9:16` |
| `count` | `1` | 生成张数 |
| `resolution` | `1k` | `1k` / `2k` / `4k` |
| `download` | `true` | 是否存到工作区 |
| `dryRun` | `false` | 只构建请求 |

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
| `dryRun` | `false` | 只构建请求 |

---

## 为什么模型不用写死

插件调的是网页端自己用的两个接口：

```
POST /mweb/v1/get_common_config              → 生图模型
POST /mweb/v1/video_generate/get_common_config → 生视频模型
```

返回里带 `model_req_key`、`model_name`、`model_tip`、`duration_option`、`video_aspect_ratio_option`、`feats`。插件把这些当数据用，所以：

- **新模型上线** → 自动出现在 `jimeng_models`
- **时长范围变了** → 自动跟着变
- **模型被下架** → 自动消失

不用发版。今天是 Seedance 2.5，出 3.0 那天你直接用就行。

---

## 实现原理

桌面端是 Electron，登录态以明文 Cookie 存在：

```
%APPDATA%\dreamina-desktop\Partitions\dreamina-web\Network\Cookies
```

插件用 `node:sqlite` 读这个库取 `sessionid`，再按网页端规则签名：

```js
md5(`9e2c|${uri.slice(-7)}|7|5.8.0|${deviceTime}||11ac`)
```

带 `Device-Time` / `Sign` / `Sign-Ver` 头，伪装成 Chrome 142，然后：

- `POST /mweb/v1/aigc_draft/generate` → 提交任务
- `POST /mweb/v1/get_history_by_ids` → 轮询到出片

---

## 常见问题

<details>
<summary><b>提示「读取即梦 Cookies 失败」</b></summary>

即梦客户端运行时会把 Cookies 数据库独占。**退出客户端再调用**即可。

或者绕过它：在配置里用 `cookieHeader` 手填 Cookie 字符串。
</details>

<details>
<summary><b>提示「积分不足」</b></summary>

先去即梦客户端充值。插件在提交前会查余额，余额为 0 时直接拒绝，不会白扣。
</details>

<details>
<summary><b>装完工具没出现</b></summary>

重启 dsh。Host 侧插件在进程启动时解析模块路径。
</details>

<details>
<summary><b>怎么确保不烧积分</b></summary>

三重保险：`jimeng_status` 查余额 → `dryRun` 验请求 → `minCreditsToKeep` 设下限。全都不花钱或自动止损。
</details>

<details>
<summary><b>支持图生视频吗</b></summary>

暂时只做文生图 / 文生视频。模型返回的 `feats` 里已经有 `support_first_image` / `support_end_image` 标记，后续可以接。
</details>

---

## 已知限制

- **即梦客户端运行时读不到 Cookies**（文件独占）—— 退出客户端，或用 `cookieHeader`
- 只支持文生图 / 文生视频
- 一次只能跑一个任务
- 依赖桌面端 Cookie 存储格式，即梦改了就得跟
- 接口非官方公开，随时可能变

---

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

---

## 免责声明

本项目通过本机已登录的客户端会话调用即梦网页端接口，仅供**个人学习和自动化效率**使用。

- 生成内容会真实消耗你账号的积分
- 请遵守[即梦用户协议](https://jimeng.jianying.com)和当地法律法规
- 接口非官方公开，随时可能变化；作者不保证长期可用

---

## License

[MIT](LICENSE) © MokoKing666

<div align="center">
<sub>如果这个项目帮你省了事，给个 ⭐ 吧</sub>
</div>
