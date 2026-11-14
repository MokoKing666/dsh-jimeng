# 给仓库补 Topics（一条命令）

仓库已经推上去了，但 **Topics** 需要在 GitHub 上单独设置。网页端 `github.com` 这会儿连不上，用下面任意一种方式补。

Topics 的作用：让搜索 `dsh plugin`、`seedance`、`即梦` 的人能刷到这个仓库。

## 方式一：网页（最快）

打开 https://github.com/MokoKing666/dsh-jimeng-seedance

1. 右侧 **About** 齿轮图标
2. **Topics** 里逐个粘贴下面这串（每按一次回车加一个）：

```
deepseek-harness
dsh
dsh-plugin
dsh-bundle
seedance
seedance-2.5
jimeng
即梦
dreamina
text-to-video
ai-video
video-generation
```

3. **Save changes**

## 方式二：gh CLI

```bash
gh auth login            # 先登录一次
gh repo edit MokoKing666/dsh-jimeng-seedance \
  --add-topic deepseek-harness,dsh,dsh-plugin,dsh-bundle,seedance,seedance-2.5,jimeng,dreamina,text-to-video,ai-video,video-generation
```

## 方式三：curl + PAT

去 https://github.com/settings/tokens 建一个带 `public_repo` 的 token，然后：

```bash
curl -X PUT \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/MokoKing666/dsh-jimeng-seedance/topics \
  -d '{"names":["deepseek-harness","dsh","dsh-plugin","dsh-bundle","seedance","seedance-2.5","jimeng","dreamina","text-to-video","ai-video","video-generation"]}'
```

## 顺便可以做的

- **About 描述** 已经写好了，不用改
- 仓库是 **public**，MIT 协议，README 中英双语
- 想要更显眼，可以在 About 里勾上 **Releases**（等你打第一个 tag）

---

> 这一步做完，别人搜 `dsh plugin seedance` 或 `即梦 插件` 就能找到它了。
