# 参与贡献

谢谢你有兴趣改进这个项目。下面是最小可用的流程。

## 报告问题

开 Issue 前先搜一下有没有重复。带上这些信息能让定位快很多：

- dsh 版本（`dsh --version`）
- 操作系统
- 即梦客户端版本
- 报错的完整信息（**贴之前把 Cookie、sessionid、视频链接里的签名参数去掉**）
- 复现步骤

## 提 PR

1. Fork 并新建分支：`git checkout -b feat/your-feature`
2. 改动尽量聚焦，一个 PR 做一件事
3. 本地验证：装进 dsh 后真实跑一次 `seedance_generate`
4. 提交信息用祈使句：`Add first-frame image support`
5. 开 PR，说明改了什么、为什么

## 想做的方向

- [ ] 首帧 / 尾帧图生视频（接口字段 `first_frame_image` / `end_frame_image` 已预留）
- [ ] 视频编辑（Seedance 2.5 新能力）
- [ ] 生成历史列表工具
- [ ] macOS / Linux 路径适配
- [ ] 失败重试与积分不足时的自动降级

## 代码风格

- 纯 ESM，不引入构建步骤
- 不新增运行时依赖（Node 内置模块够用）
- 错误信息用中文，说清**哪一步失败、下一步该做什么**
- 不要在日志或错误里输出 Cookie / sessionid / 带签名的视频地址

## 安全

**不要**在 Issue、PR 或任何公开地方贴出你的 Cookie 或 sessionid。那些等价于账号密码。

发现安全问题请走私信而不是公开 Issue。
