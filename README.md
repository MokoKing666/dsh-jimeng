<div align="center">

<img src="icon.svg" width="96" height="96" alt="dsh-jimeng-seedance">

# dsh-jimeng-seedance

**在 DeepSeek Harness 里直接调用即梦 Seedance 出片 —— 复用桌面端已登录的账号，不用 API Key。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4c6ef5)](https://github.com/deepseek-ai)
[![Seedance](https://img.shields.io/badge/Seedance-2.5%20%7C%202.0-ff6b6b)](https://jimeng.jianying.com)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)]()

[功能](#功能) · [安装](#安装) · [用法](#用法) · [实现原理](#实现原理) · [常见问题](#常见问题) · [English](README.en.md)

<img src="docs/preview.jpg" width="720" alt="Seedance 2.5 生成样片：海边日落海鸥">

<sub>上面这帧来自本插件真实生成的 Seedance 2.5 视频（4 秒 / 16:9 / 720p）</sub>

</div>

---

## 这是什么

一个 **DeepSeek Harness 插件（bundle）**，给 Agent 装上两个原生工具：

| 工具 | 作用 | 消耗积分 |
| --- | --- | --- |
| `seedance_generate` | 文生视频：提交任务 → 轮询到完成 → 把 MP4 下载到工作区 | ✅ 是 |
| `seedance_status` | 查登录态和积分余额 | ❌ 否 |

装好之后，你在 dsh 里说一句「用 seedance 生成一段……」，Agent 就会自己出片并把文件放到工作区，**不需要打开即梦客户端，不需要填 API Key，不需要另跑服务**。

### 和其他方案的区别

| 方案 | 需要什么 | 能不能到 2.5 |
| --- | --- | --- |
| **本项目** | 本机装好并登录「即梦 AI」桌面端 | ✅ `seedance-2.5` |
| 官方火山方舟 API | 实名 + 开通 + API Key + 付费 | ✅ 但要钱 |
| new-api / one-api 中转 | 自建中转站 + 令牌 | 部分只到 2.0 |
| jimeng-free-api 类项目 | 单独跑一个 HTTP 服务 + 手动贴 Cookie | ✅ 但要多维护一个进程 |

本项目的定位很明确：**你机器上已经有的那个即梦账号，直接拿来用。**

---

## 功能

- **Seedance 2.5 / 2.0 全系**：`seedance-2.5`、`seedance-2.0`、`seedance-2.0-fast`、`seedance-2.0-mini`
- **时长**：2.5 支持 4–30 秒，2.0 系列支持 4–15 秒
- **比例**：`21:9` `16:9` `4:3` `1:1` `3:4` `9:16`
- **自动落盘**：按时间戳 + 任务 id 命名，直接进工作区 `jimeng-videos/`
- **积分前置检查**：生成前先查余额，不够直接报错，不会白提交任务
- **登录态自动发现**：自动定位桌面端 Cookie 库，换机器也不用改路径
- **网络重试**：传输失败自动重试两次，错误信息说清是哪一步挂了

---

## 安装

### 前置条件

1. 已安装 **DeepSeek Harness**（0.2.x）
2. 本机安装并**登录**了 [即梦 AI 桌面客户端](https://jimeng.jianying.com)
3. 账号里有可用积分（生成会真实扣费）
4. Node.js ≥ 22.5（`node:sqlite` 内置模块要求；DSH 自带的 Node 24 已满足）

### 方式一：一条命令（推荐）

```bash
git clone https://github.com/MokoKing666/dsh-jimeng-seedance.git
cd dsh-jimeng-seedance
dsh plugin --profile desktop add .
```

### 方式二：在 dsh 里让 Agent 装

把仓库地址丢给 Agent，说「装这个插件」，它会走 `plugin_manager install_bundle`。

### 方式三：手动

在 dsh 的 **Plugins** 页面点 **Add plugin**，选这个仓库的本地目录。

> **提示**：安装后如果工具没出现，重启一次 dsh（托盘退出再启动）。Host 侧插件在首次加载后需要重新解析模块路径。

---

## 用法

装好后直接在对话里说人话就行：

```
用 seedance 生成一段：一只橘猫在午后窗台上伸懒腰，阳光斜射形成丁达尔光束，
镜头缓慢推进，浅景深，电影感暖色调
```

Agent 会调用 `seedance_generate`，你可以顺带指定参数：

```
生成一条 9:16 竖屏、10 秒的城市夜景航拍，霓虹灯牌倒映在雨后的街道，
镜头缓慢下降，赛博朋克色调
```

### `seedance_generate` 参数

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | **必填** | 提示词。中文效果最好，写清主体、动作、运镜、光线、风格 |
| `model` | string | `seedance-2.5` | `seedance-2.5` / `seedance-2.0` / `seedance-2.0-fast` / `seedance-2.0-mini` |
| `ratio` | string | `16:9` | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` |
| `duration` | integer | `5` | 秒。2.5 支持 4–30，2.0 支持 4–15 |
| `resolution` | string | `720p` | 网页端当前只开放 720p |
| `download` | boolean | `true` | 是否保存到工作区；`false` 只返回地址 |

返回：任务 id、模型、比例、时长、视频地址、本地保存路径、文件大小。

### `seedance_status`

不消耗积分，随时可以问：

```
现在即梦还剩多少积分？
```

---

## 配置

默认零配置即可工作。需要调整时，在 profile 的 `cordis.patch.yml` 里覆盖 `jimeng-seedance` 行的 `config`：

```yaml
- id: jimeng-seedance
  name: '@local/dsh-jimeng-seedance'
  config:
    cookieDbPath: ''          # 留空自动探测；也可填绝对路径
    downloadDir: jimeng-videos
    pollIntervalMs: 5000
    pollTimeoutMs: 900000
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `cookieDbPath` | `''` | 桌面端 Cookie 库路径，留空自动探测 |
| `downloadDir` | `jimeng-videos` | 成片目录，相对工作区 |
| `pollIntervalMs` | `5000` | 轮询间隔 |
| `pollTimeoutMs` | `900000` | 最长等待 15 分钟 |

---

## 实现原理

桌面端是 Electron 应用，登录态以**明文 Cookie** 存在本地 SQLite 里：

```
%APPDATA%\dreamina-desktop\Partitions\dreamina-web\Network\Cookies
```

插件做三件事：

1. **读登录态** —— 用 `node:sqlite` 直接读这个库，取出 `sessionid` 等字段（不需要解 DPAPI，因为是明文存的）
2. **按网页端规则签名** ——
   ```js
   md5(`9e2c|${uri.slice(-7)}|7|5.8.0|${deviceTime}||11ac`)
   ```
   带 `Device-Time` / `Sign` / `Sign-Ver` 头，伪装成 Chrome 142
3. **提交 + 轮询 + 下载**
   - `POST /mweb/v1/aigc_draft/generate` → 拿 `history_record_id`
   - `POST /mweb/v1/get_history_by_ids` → 轮询到 `status=50` 且有视频地址
   - 下载 MP4 到工作区

模型映射：

| 参数值 | `model_req_key` |
| --- | --- |
| `seedance-2.5` | `dreamina_seedance_45_pro` |
| `seedance-2.0` | `dreamina_seedance_40_pro` |
| `seedance-2.0-fast` | `dreamina_seedance_40` |
| `seedance-2.0-mini` | `dreamina_seedance_40_mini` |

---

## 常见问题

<details>
<summary><b>提示「即梦桌面端尚未登录」</b></summary>

打开即梦 AI 客户端重新登录一次。插件读的是那份 Cookie，不会自己刷新。登录后无需重启 dsh，下次调用会自动读到新 Cookie。
</details>

<details>
<summary><b>提示「积分不足 ret=1006」</b></summary>

先去即梦客户端充值。插件在提交前会查一次余额，余额为 0 时直接报错，不会白扣。
</details>

<details>
<summary><b>装完工具没出现</b></summary>

重启 dsh。Host 侧插件在进程启动时解析模块路径，装完新版本后需要重启才能重新加载。
</details>

<details>
<summary><b>找不到 Cookie 库</b></summary>

确认客户端装在默认位置。如果不是，在配置里填 `cookieDbPath`：

```
C:\Users\<你>\AppData\Roaming\dreamina-desktop\Partitions\dreamina-web\Network\Cookies
```
</details>

<details>
<summary><b>支持图生视频 / 首帧尾帧吗</b></summary>

暂不支持，当前只做文生视频。接口层已经预留了 `first_frame_image` / `end_frame_image` 字段，后续可以加。
</details>

<details>
<summary><b>能并行生成多个吗</b></summary>

不能。一次调用会占住一个工具调用直到出片（最长 15 分钟），期间不能发起第二个。
</details>

<details>
<summary><b>会消耗多少积分</b></summary>

以即梦官方计费为准，按秒数和分辨率扣。生成前用 `seedance_status` 查余额最稳。
</details>

---

## 限制

- 只支持**文生视频**，图生视频未接入
- 网页端只开放 **720p**
- 桌面端**退出登录**后需要重新登录
- 一次只能跑一个任务
- 依赖桌面端本地 Cookie 库的存储格式；如果即梦改了加密方式，需要跟着改

---

## 卸载

```bash
dsh plugin --profile desktop remove @local/dsh-jimeng-seedance
```

或在 **Plugins** 页面禁用/删除。

---

## 贡献

欢迎 Issue 和 PR。特别想要的方向：

- 首帧/尾帧图生视频
- 视频编辑（Seedance 2.5 新增能力）
- 生成历史列表工具
- macOS / Linux 路径适配（当前只测了 Windows）

---

## 免责声明

本项目通过本机已登录的客户端会话调用即梦网页端接口，仅供**个人学习和自动化效率**使用。

- 生成内容会真实消耗你账号的积分
- 请遵守[即梦用户协议](https://jimeng.jianying.com)和当地法律法规
- 不要用于批量刷量、二次分发或其他滥用场景
- 接口非官方公开，随时可能变化；作者不保证长期可用

---

## License

[MIT](LICENSE) © MokoKing666

<div align="center">
<sub>如果这个项目帮你省了事，给个 ⭐ 吧</sub>
</div>
