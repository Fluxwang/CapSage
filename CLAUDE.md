# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 这个仓库是什么

**EchoSage** —— 一个 Chrome 扩展（MV3），把两个前身扩展合并成一个产品：捕获标签页音频做实时转写、翻译成中文、以双轨字幕呈现，覆盖"任意网站的直播实时字幕"和"TikTok 视频字幕/总结/仿写"两个场景。

**当前状态：合并尚未开始写代码。** 这个仓库目前只有文档（规格、领域词汇、ADR），扩展本身一行代码都还没有。真正的代码迁移按 `.scratch/echosage-merge/` 下的票逐张推进。

### 目录里的两个前身项目

`echocap/` 和 `tiktok-caption-studio/` 是两个前身扩展，各自是**独立的嵌套 git 仓库**（有自己的 `.git` 和提交历史），不属于本仓库的跟踪范围。它们是**迁移的来源材料**，不是本仓库的代码。合并完成后它们会被移出或归档。

- **`echocap/`** —— 面向任意标签页的实时西语→中文直播字幕悬浮层。已经跑通的能力：`tabCapture` → 离屏文档双 AudioContext → AudioWorklet → AssemblyAI v3 流式转写 → Chrome 内置 Translator（Gemini Nano）本地翻译 → content script 悬浮双轨字幕。它有自己的 `CLAUDE.md`、`CONTEXT.md` 和 `docs/brief.md`——迁移它的代码前先读这三份，尤其是 `CLAUDE.md` 里那一串"非显而易见的不变量"（同步 dispatch 防重复捕获、零增益节点保活 worklet、offscreen 里没有 `chrome.storage` 等），那些注释记录的是踩过的坑。注意 `echocap/AGENT.md` 是过时副本，以 `echocap/CLAUDE.md` 为准。
- **`tiktok-caption-studio/`** —— TikTok 视频详情页工具，无构建步骤的纯 JS/HTML/CSS。`inject.js` 在 MAIN world 于 `document_start` 打补丁 `fetch`/`XHR` 拦截 TikTok 自己的接口响应（因为页面水合数据只覆盖首个视频，后续视频只出现在各自的 API 响应里）；`content.js` 在隔离世界管页内 UI 和"当前活跃视频"追踪；`background.js` 是唯一持有 API Key、调用外部接口的地方；`offscreen.js` 存在纯粹因为 MV3 service worker 没有 `MediaRecorder`。

**这两份 ADR 编号已经并入本仓库**：`docs/adr/0001`–`0007` 来自 echocap，`0008`–`0010` 是本次合并新增的。迁移 echocap 代码时不要再把它的 `docs/adr/` 重复搬一遍。

## 合并后的目标架构

以下是**已决定但尚未实现**的结构，权威来源是 `.scratch/echosage-merge/spec.md`：

- 一个扩展、一个 `manifest.json`、一个工具栏图标、一个 popup（"直播实时" / "视频字幕" 两个 Tab）、一份共享设置。
- 三个 content script 入口：`inject.js`（TikTok-only、MAIN world、不进 bundle）、`content-tiktok.js`（TikTok-only、隔离世界）、`content-overlay.js`（`<all_urls>`、隔离世界、悬浮层）。
- 转写统一走 AssemblyAI 流式；Whisper 和微软 Azure Translator **不迁移过来**（见 ADR-0008）。
- 翻译引擎两个：Chrome 内置 nano（默认，即时翻译）和 AI 模型（整段批量翻译）——**但引擎选择权只属于视频字幕场景**，直播实时场景固定本地翻译，不提供云端选项（ADR-0003 + ADR-0008）。另有一个正交的「译文触发时机」轴（停顿 / 句子，ADR-0007），两个场景共享。
- 构建：esbuild，`shared/` 放公共模块，产物进 `dist/`；`core/` 纯逻辑模块不经过 bundler，被 Node 内置 test runner 直接 import（见 ADR-0010）。
- **`core/` 是本项目唯一的测试 seam**：任何不碰浏览器 API 的状态机/判定逻辑都放这里，用 `node --test` 测，不 mock 浏览器全局对象。

## 文档去哪找

- `CONTEXT.md` —— 合并后的领域词汇表（场景/音频与转写/翻译/呈现）。动任何跟这些概念相关的代码前先读它，用里面的词，不要另造同义词。
- `docs/adr/` —— 编号的架构决策记录。做架构层面的改动前先查，尤其是 `0003`（只用内置 Translator）、`0005`（花钱保险丝）、`0007`（译文触发时机）、`0008`–`0010`（本次合并）。
- `.scratch/echosage-merge/spec.md` —— 本次合并的完整规格（问题/方案/user stories/实现决定/测试决定/范围外）。
- `Popup 合并设计.dc.html` —— 前端 UI 设计稿（popup 三态、设置页四个分区、侧边栏两个子页）。顶层这份是最新的、含侧边栏；如果在 `echocap/` 下看到同名文件，那是旧副本，不要参考。

## Agent skills

### Issue tracker

Issues 和 specs 以 markdown 文件形式存在 `.scratch/<feature-slug>/` 下——没有远程 issue tracker。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个规范角色，作为标签字符串原样使用（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），记为每个 issue 文件里的 `Status:` 行。见 `docs/agents/triage-labels.md`。

### Domain docs

单一 context：仓库根的 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。
