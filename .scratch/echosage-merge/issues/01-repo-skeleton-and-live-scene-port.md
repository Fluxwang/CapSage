# 01 — 仓库骨架、esbuild 构建与直播实时场景迁移

**What to build:** 装上这个扩展，点工具栏图标，popup 里出现"直播实时"Tab（此时唯一的 Tab），点开始就能捕获当前标签页音频、实时转写、本地翻译成中文，并在页面上渲染双轨悬浮字幕——也就是前身 echocap 的完整体验，只是跑在新仓库、新构建流水线、新名字（EchoSage）下。这一票不新增任何用户可见功能，是后续所有票的地基。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

来源材料是工作目录里的 `echocap/`（嵌套的独立 git 仓库，不被本仓库跟踪）。动它的代码前先读 `echocap/CLAUDE.md` 里那串"非显而易见的不变量"——同步 dispatch 防重复捕获、零增益节点保活 worklet、offscreen 里没有 `chrome.storage`、`getMediaStreamId` 必须在用户手势调用链里同步调用——那些注释记录的是踩过的坑，迁移时一条都不能丢。

- [ ] `build.mjs` 用 esbuild 把各浏览器入口打包进 `dist/`，watch 模式可用；`manifest.json` 引用的是 `dist/` 产物（ADR-0010）
- [ ] `core/` 从 echocap 迁入并保持**不经过 bundler**，`node --test` 能直接跑通既有测试
- [ ] manifest `name` 与所有用户可见文案都是 EchoSage
- [ ] popup「直播实时」Tab：开始/停止捕获、VU 表、实时转写列表（已定稿单位 + 进行中的 partial）
- [ ] 悬浮层在被捕获页面渲染双轨字幕，原文轨视觉弱化、译文轨为主视觉
- [ ] 「译文触发时机」（停顿 / 句子，ADR-0007）随代码一起迁移，行为不变
- [ ] 长静音自动断连与会话硬上限（ADR-0005）行为不变
- [ ] 直播场景**不出现**任何翻译引擎选择器，翻译只走 Chrome 内置（ADR-0003）
- [ ] echocap 的 ADR 与 `docs/agents/` 已经并入本仓库，**不要重复迁移**
- [ ] 迁移完成后，新代码不再从 `echocap/` 目录引用任何文件
