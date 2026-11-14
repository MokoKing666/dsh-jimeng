# 插件说明

## 它做什么

给 DeepSeek Harness 装上两个原生工具，通过本机「即梦 AI」桌面端已经登录的会话生成 Seedance 视频，不额外配置 API Key。

## 两个工具

### `seedance_generate`

提交文生视频任务 → 轮询到完成 → 把 MP4 下载到工作区。

| 参数 | 说明 |
| --- | --- |
| `prompt` | 提示词，必填。中文效果最好，写清主体、动作、运镜、光线、风格。 |
| `model` | `seedance-2.5`（默认）、`seedance-2.0`、`seedance-2.0-fast`、`seedance-2.0-mini`。 |
| `ratio` | `21:9` `16:9`（默认）`4:3` `1:1` `3:4` `9:16`。竖屏短视频用 `9:16`。 |
| `duration` | 秒数。seedance-2.5 支持 4–30，2.0 系列支持 4–15。默认 5。 |
| `resolution` | 当前网页端只开放 `720p`。 |
| `download` | 默认 `true`，保存到 `<工作区>/jimeng-videos/`。设 `false` 只返回地址。 |

返回：任务 id、模型、比例、时长、视频地址、本地保存路径与文件大小。

### `seedance_status`

报告登录态与积分（VIP / 赠送 / 购买 / 合计），不消耗积分。生成失败或想确认额度时先跑它。

## 实现方式

桌面端是 Electron 应用，登录态以明文 Cookie 存在
`%APPDATA%\dreamina-desktop\Partitions\dreamina-web\Network\Cookies`。插件用 `node:sqlite`
直接读这个库取出 `sessionid` 等字段，再按网页端规则签名
（`md5("9e2c|" + uri 末 7 位 + "|7|5.8.0|" + 时间戳 + "||11ac")`），
调用 `jimeng.jianying.com` 的 `/mweb/v1/aigc_draft/generate` 提交、
`/mweb/v1/get_history_by_ids` 轮询。

`seedance-2.5` 对应的 `model_req_key` 是 `dreamina_seedance_45_pro`。

## 限制

- 只支持文生视频；首帧/尾帧图生视频未接入
- 网页端只开放 720p
- 桌面端退出登录后需要重新登录，插件读取的是那份 Cookie，不会自己刷新
- 一次调用会占住一个工具调用直到出片（默认最长等 15 分钟），期间不能并行发起第二个
- 生成消耗的是账号真实积分

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖 `jimeng-seedance` 行的 `config`：

```yaml
- id: jimeng-seedance
  name: '@local/dsh-jimeng-seedance'
  config:
    cookieDbPath: ''          # 留空自动探测；也可填绝对路径
    downloadDir: jimeng-videos
    pollIntervalMs: 5000
    pollTimeoutMs: 900000
```
