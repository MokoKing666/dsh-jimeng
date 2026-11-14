# 安全策略

## 支持的版本

| 版本 | 是否维护 |
| --- | --- |
| 1.x | ✅ |

## 报告漏洞

**不要开公开 Issue。** 走 GitHub 的 [Private vulnerability reporting](https://github.com/MokoKing666/dsh-jimeng-seedance/security/advisories/new)，或者直接发邮件到仓库 owner 的公开邮箱。

## 这个插件会碰到哪些敏感数据

- **即梦账号的 Cookie**：插件从桌面端的 SQLite 库里读 `sessionid`，只在内存里用于请求签名，**不写日志、不落盘、不联网传输到第三方**
- **生成的视频地址**：带签名参数，有时效性；插件只把它写进工具返回值和下载请求
- **积分余额**：只读，用于生成前的前置检查

## 你需要注意的

- 不要把带 Cookie 的日志贴到 Issue 里
- `sessionid` 等价于账号密码，泄露等于账号被盗
- 插件不会、也不应该被改成把 Cookie 发到别处
