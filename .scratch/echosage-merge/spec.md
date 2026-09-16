Status: ready-for-agent

# 合并 EchoCap 与 TikTok Caption Studio 为 EchoSage

## Problem Statement

用户（本人）日常同时装着两个各自独立的 Chrome 扩展：EchoCap（盯着 TikTok Live 之类的直播标签页，实时把西语转写、翻译成中文，悬浮在画面上）和 TikTok Caption Studio（在 TikTok 视频详情页拉字幕、翻译、生成总结/仿写文案）。两者互不知晓对方存在——各自一个工具栏图标、各自一套 API Key/语言/翻译引擎配置、各自维护一遍转写/翻译逻辑，且各自都有明显的臃肿或缺口：EchoCap 只认西班牙语，没有视频这类"有限时长"内容的概念；TikTok Caption Studio 遇到没有原生字幕的视频时，退而求其次用 Whisper 批量转写，效果和体验都不如 EchoCap 已经跑通的实时流式转写+悬浮双语字幕。装两个扩展、配两遍参数、字幕体验还不一致，这本身就是需要解决的问题。

## Solution

把两个扩展合并成一个新产品 **EchoSage**：一个 git 仓库、一个 manifest、一个工具栏图标、一个 popup（含"直播实时"和"视频字幕"两个 Tab）、一份共享设置。两个场景共用同一套底层基础设施——AssemblyAI 实时流式转写、翻译引擎（Chrome 内置 nano 默认 / AI 模型可选）、悬浮双语字幕渲染组件——但各自的触发方式、UI 呈现、会话生命周期保持独立，不强行揉成一个模式。视频字幕场景原本"没有原生字幕就用 Whisper 批量转写"的兜底路径，替换成复用 EchoCap 的 AssemblyAI 实时流；原本"AI 模型 / 微软"二选一的翻译引擎，替换成"AI 模型（整段批量）/ Chrome 内置 nano（逐句实时，默认）"。新增一个"侧边栏"呈现面（填充原 TikTok Caption Studio 里一直空着的 `sidepanel/` 占位目录），承载完整的字幕列表和总结/仿写工作区；popup 保留紧凑预览。

详细的领域词汇和"为什么这么决定"见 [`CONTEXT.md`](../../CONTEXT.md) 和 [`docs/adr/0001`](../../docs/adr/0001-drop-whisper-and-microsoft-translate.md)–[`0003`](../../docs/adr/0003-adopt-esbuild-for-shared-modules.md)。

## User Stories

### 直播实时场景

1. As a user, I want one popup with a "直播实时" tab, so that I don't need a separate toolbar icon just for live captioning.
2. As a user, I want to click "开始捕获当前标签页音频" on any website, so that I get live captions regardless of which platform is streaming (not just TikTok).
3. As a user, I want the captured tab's original audio to keep playing after I start capture, so that I'm not silently muted while watching.
4. As a user, I want to pick a source language from a dropdown before starting, so that AssemblyAI transcribes the right language instead of being locked to Spanish.
5. As a user, I want the target language fixed to Simplified Chinese with no selector, so that I'm not asked to make a choice that only has one sensible answer.
6. As a user, I want to see a live-updating transcript inside the popup (finalized turns + an in-progress partial line), so that I can follow along without relying on the overlay.
7. As a user, I want a floating bilingual subtitle overlay on the captured page, so that I can keep watching the video while reading captions.
8. As a user, I want the overlay's source-language track visually de-emphasized and the translation track to be the primary visual, so that the Chinese translation is what actually draws my eye.
9. As a user, I want translation to appear turn-by-turn immediately when using the default Chrome built-in engine, so that Chinese shows up with minimal delay.
10. As a user, I want the option to switch to the AI-model translation engine, understanding it will only produce a single batch of translations after I stop the session, so that I can trade real-time display for potentially better cross-sentence context.
11. As a user, I want the session to auto-disconnect after a long silence and to hard-stop at a session duration cap, so that I don't get billed for a forgotten, silent, or abandoned capture.
12. As a user, I want an explicit "停止" button, so that I can end a session immediately regardless of the automatic safeguards.
13. As a user, I want this scene's cost/session controls to apply independently per session, so that running a live capture in one tab doesn't get throttled or blocked by a video-scene transcription running in another tab.

### 视频字幕场景

14. As a user, I want a "视频字幕" tab in the same popup, so that I manage TikTok video captions from the same extension icon as live captioning.
15. As a user, I want the extension to prefer TikTok's native WebVTT subtitle track whenever one exists, so that I get accurate captions without spending any transcription budget.
16. As a user, I want the extension to fall back to AssemblyAI real-time streaming transcription only when a video has no native subtitle track, so that transcription cost is only incurred when actually necessary.
17. As a user, I want that fallback streaming transcription to stop automatically once the video has played through one full loop, so that a video set to auto-loop doesn't get re-transcribed indefinitely and run up cost.
18. As a user, I want to choose between "手动点击获取字幕" / "自动获取字幕" / "自动获取并自动翻译" for what happens when I switch to a new video, so that I control how much of this happens without me clicking anything (and therefore how much API spend happens automatically).
19. As a user, I want to see a compact bilingual cue list for the currently active video right in the popup, so that I can check captions without opening anything else.
20. As a user, I want a "复制" action for the subtitle text, so that I can paste it elsewhere.
21. As a user, I want "总结" and "仿写" buttons in the popup that open the sidebar to the matching tab (rather than trying to render that content inside the cramped popup), so that I have enough room to actually read the output.
22. As a user, I want a "侧边栏" entry point that opens a full-height panel docked to the right edge of the TikTok page, so that I can work with captions/summary/rewrite alongside the video without leaving the page.
23. As a user, I want the sidebar's caption view to support a "跟随播放" toggle that auto-highlights/scrolls the currently-playing line by `video.currentTime`, so that I can follow along as the video plays.
24. As a user, I want a "悬浮窗" toggle in the sidebar, so that I can optionally render video captions as an on-video overlay (the same overlay component the live scene uses) instead of, or alongside, the sidebar list.
25. As a user, I want an "AI 翻译" quick-toggle in the sidebar that overrides just this video's translation to the AI-model engine (batch, after transcription finishes), so that I don't have to visit settings for a one-off higher-effort translation.
26. As a user, I want the sidebar's "总结和仿写" tab to show a numbered list of video key points and a rewritten-script generator with a duration/type selector, so that I can produce promotional-style derivative content from the transcript.
27. As a user, I want the existing shopping-bag/product-link features (cover-icon hover preview, "查看商品" opening TikTok's product page) to keep working exactly as before, so that the merge doesn't regress functionality unrelated to captioning.

### 设置

28. As a user, I want one settings page with sections for "直播实时" / "视频字幕" / "叠加层外观" / "关于", so that I configure the whole product in one place instead of two separate options pages with duplicated fields.
29. As a user, I want to enter my AssemblyAI API key once and have both scenes use it, so that I don't configure it twice.
30. As a user, I want to trigger the Chrome built-in Translator model download from settings, and have that download prompt re-appear for a new language pair whenever I switch source language, so that I always have a working local model for whichever language I'm actually transcribing.
31. As a user, I want to choose when Chinese translation appears in the live scene (等主播停顿 vs 每说完一句就翻译), so that I can balance translation context quality against latency.
32. As a user, I want to configure Base URL / API Key / 聊天模型 for the AI-model translation engine and for 总结/仿写 without that endpoint needing to support any audio-transcription API, so that any OpenAI-compatible chat gateway works, including ones that only ever supported chat completions.
33. As a user, I want to pick an accent color used consistently across popup/sidebar/settings, while the floating overlay itself always stays white-text-on-black regardless of accent, so that overlay legibility against arbitrary video backgrounds is never compromised by a color choice made for UI chrome.
34. As a user, I want an "关于" page that explains what changed in the merge, so that I have a quick orientation to the merged product instead of rediscovering it by trial and error.

### 品牌 / 仓库

35. As a user, I want the merged product named and branded "EchoSage" everywhere it's user-visible (manifest name, popup header, options page title), replacing "EchoCap" and "TikTok Caption Studio".
36. As a user, I want the merge to happen in a brand-new git repository at the `capsage/` root with a clean history (not a history-preserving merge of the two old repos), while the two original repos stay on disk untouched as archives, so that old code/commits remain available for reference without cluttering the new project's history.

## Implementation Decisions

**Overall structure**
- Single MV3 extension, one `manifest.json`, one toolbar `action`/popup entry point.
- popup has two tabs — "直播实时" and "视频字幕" — matching the confirmed design (`Popup 合并设计.dc.html`, see UI Design Reference below). A third popup state ("未开始 / 模型未下载") covers idle/model-download-pending.
- Settings (`options.html`) has four sections in a left sidebar: 直播实时 / 视频字幕 / 叠加层外观 / 关于. Global fields (AssemblyAI key, accent color) live once; per-scene fields live under their own section.
- Product name: **EchoSage** (manifest `name`, all user-visible strings).

**Transcription / translation**
- 转写来源优先级（视频字幕场景）：TikTok 原生 WebVTT 优先；无原生字幕轨时，触发 AssemblyAI 实时流式转写（复用直播实时场景的连接/会话逻辑，语言参数不同）。
- Whisper 转写路径整个删除：不保留 `whisperModel` 设置、不要求 Base URL 支持 `/v1/audio/transcriptions`。见 ADR-0001。
- 翻译引擎全局二选一：Chrome 内置 nano（默认，逐句实时——话轮定稿立刻本地翻译）/ AI 模型（转写完全结束后，把累积全部文本一次性发给已配置的 Base URL/API Key/聊天模型接口，批量换回整段译文；会话进行中译文轨留空或标"翻译中"）。AI 模型不支持逐句调用。微软 Azure Translator 整个下线。见 ADR-0001。
- 侧边栏"AI 翻译"开关只是"翻译引擎"设置的单视频快捷覆盖，不是第三种翻译方式。
- 源语言参数化：AssemblyAI `language_codes` 和 Chrome Translator `sourceLanguage` 都从写死的 `"es"` 改成可配置值，两个场景通用；目标语言锁死 `"zh"`，UI 上不做选择器。
- 模型下载 UI 要跟随当前选中的源语言——切换到一个未下载过的语言对时，重新出现下载提示/进度,不是只有一个固定的 es→zh 下载入口。
- 视频字幕场景的流式会话在**播完一轮**（`currentTime` 从接近 `duration` 跳回接近 0）后自动停止定稿，不受 TikTok 视频自动循环播放影响持续转写；与长静音断连/会话硬上限（复用直播场景现有 ADR-0005 逻辑）并存，任一条件先触发就停。见 ADR-0002。
- 两个场景的会话/成本控制（长静音断连、硬上限、播完一轮）各自独立生效，不设跨标签页的全局并发上限——直播实时和视频字幕的流式会话可以同时在不同标签页运行，互不阻塞、互不影响彼此的花费上限判定。

**UI 呈现面（三个，共享数据/组件，容器不同）**
- **popup**：紧凑视图。直播实时 Tab 显示实时转写摘要+悬浮层开关+VU 表+开始/停止；视频字幕 Tab 显示紧凑字幕列表（时间戳+原文+译文）+复制+总结/仿写/侧边栏三个入口按钮。"总结"/"仿写"点击后不在 popup 内展开内容，而是唤出侧边栏并跳到对应子 Tab。
- **侧边栏**（`sidepanel/`，此前是空占位目录，本次填充）：视频字幕场景专属，400px 宽、页面整高，从右侧推开页面显示。两个子 Tab："字幕和翻译"（完整字幕列表，支持"跟随播放"按 `video.currentTime` 高亮/滚动、"双语"显示开关、"悬浮窗"开关、"AI 翻译"快捷开关、复制全文、导出、总结入口）和"总结和仿写"（视频要点列表+仿写脚本生成器，带口播时长/类型选择）。
- **悬浮层（Overlay）**：双轨（原文轨弱化+译文轨主视觉）字幕浮层，渲染组件通用化，需同时支持两种数据喂法——直播场景的实时流式话轮增量，和视频字幕场景已攒好的、带时间戳的静态字幕数组+当前播放进度定位。直播实时场景必定使用；视频字幕场景通过侧边栏"悬浮窗"开关可选启用。悬浮层本身固定白字黑底,不跟随强调色变化。

**工程结构**
- 顶层 `capsage/` 目录新建一个干净的 git 仓库（不保留 echocap/tiktok-caption-studio 旧历史，见 ADR 决策记录之外的过程性决定，不单独立 ADR）；两个旧仓库原地留档不删。
- 引入 esbuild 构建步骤：`build.mjs` 把各浏览器入口（`background.js`、`offscreen.js`、`content-tiktok.js`、`content-overlay.js`、`popup.js`、`options.js`）打包到 `dist/`；共享代码放 `shared/` 被这些入口 `import`；`core/` 纯逻辑模块保持无构建，被 Node test runner 直接 import。见 ADR-0003。
- `inject.js`（MAIN world、`document_start`，同步打补丁 `fetch`/XHR 拦截 TikTok API 响应）保持不进 bundle、独立自包含文件,不变。
- `content_scripts` 拆三个入口：`inject.js`（TikTok-only, MAIN world，不变）、`content-tiktok.js`（TikTok-only, isolated world, `document_idle`，对应原 TikTok Caption Studio 的数据卡片/字幕列表/商品弹层/侧边栏挂载逻辑）、`content-overlay.js`（`<all_urls>`, isolated world, `document_idle`，对应原 EchoCap 的悬浮层)。TikTok 页面上后两者同时加载、独立运行，通过各自与 background 的消息通信协调状态。
- `host_permissions` 取两者并集，等价于 `["<all_urls>"]`（已覆盖 TikTok）。

## UI Design Reference

前端设计稿：`Popup 合并设计.dc.html`（顶层 `capsage/` 目录下的版本是最新的，包含侧边栏；`echocap/` 子目录下同名文件是合并前遗留的旧版本，不含侧边栏，实现时不要参考它，建议合并完成后删除以免混淆）。设计稿包含：

- **popup**（400px 宽）三种状态：直播实时 Tab 激活（捕获中/VU 表/实时转写摘要/悬浮层开关/源译语言选择/停止按钮）、视频字幕 Tab 激活（封面缩略图/源译语言选择/双语对照开关/字幕列表/总结·仿写·侧边栏三个入口）、空闲态（开始捕获引导 或 翻译模型下载进度）。
- **设置页**（760px 宽，四个左侧栏分区）：直播实时（AssemblyAI Key 录入+校验、翻译模型下载、中文译文出现时机单选）、视频字幕（AI 接口 Base URL/API Key/聊天模型/AssemblyAI 模型/字幕翻译引擎/切换新视频时 的表单，AssemblyAI 转写启用开关，自动档位费用提示）、叠加层外观（强调色选择+悬浮层效果预览）、关于（版本信息、产品由来说明、三条数字事实：1.5s 停顿阈值/0 字上传本地翻译/2→1 图标合并、更新日志·反馈·隐私链接）。
- **侧边栏**（400px 宽、页面整高）：字幕和翻译子页（带时间戳的原文+译文列表、跟随播放/悬浮窗/AI 翻译三个开关、双语显示开关、复制全文、导出、总结按钮）、总结和仿写子页（视频要点编号列表+重新生成、仿写脚本生成器+口播时长类型选择）。

实现时页面结构/文案/间距以这份设计稿为准；具体像素值/圆角/配色 token 允许工程实现时按 `shared/` 里统一的样式变量做等价替换，不需要逐像素照抄内联样式。

## Testing Decisions

沿用 EchoCap 已确立、并在本轮合并中确认延续的 seam：所有不碰浏览器 API 的状态/判定逻辑放进 `core/`，用 Node 内置 `--test` 直接测试,不经过 esbuild、不 mock 浏览器全局对象。只测外部行为（给定输入状态/事件序列，断言输出状态/判定结果），不测内部实现细节。

本次合并需要在这个既有 seam 上新增/扩展的模块：

- **扩展现有会话 reducer**（`core/session.js`）：新增"翻译时机"分叉——同一个话轮定稿事件,根据当前翻译引擎（Chrome 内置 / AI 模型）产生不同的状态转移（前者立即进入"待本地翻译"态，后者只累积文本、译文轨保持空,直到会话结束事件才整体转入"待批量翻译"态）。Prior art：现有 `core/session.js` 的 turn 状态机和 `core/audio.js` 的纯函数测试方式（`core/audio.test.js`）。
- **新增"单轮转写"判定纯函数**（建议 `core/playback.js` 或并入 `core/session.js`）：输入是一串 `{ currentTime, duration }` 采样（或等价的 timeupdate 事件序列），输出"是否已完成一轮播放"的布尔判定。不直接读 `video.currentTime`——由调用方（content script）采样后喂给这个纯函数，函数本身与 DOM/浏览器 API 无关，可用固定采样序列在 Node test 里断言边界情况（临播放完/循环回跳/暂停不动/拖进度条跳跃）。
- **会话初始化的语言参数化**：`core/session.js` 的初始化输入新增 `sourceLanguage` 字段（替代写死常量），reducer 逻辑本身不因语言变化而分叉，只是不再硬编码——用现有测试模式补一个"不同语言值透传不变"的用例即可,不需要新的测试策略。

不在这次 seam 范围内、按各自项目现状测试或不测试：UI 渲染（popup/侧边栏/悬浮层的 DOM 结构）、esbuild 构建产物、`inject.js` 的 fetch/XHR 拦截逻辑（现状就没有自动化测试，本次不新增）。

## Out of Scope

- Whisper 转写路径（整体删除，不保留兜底，见 ADR-0001）。
- 微软 Azure Translator（整体删除，见 ADR-0001）。
- 目标语言可选（锁死中文）。
- 跨标签页的全局并发会话上限（问题 13 已确认不做，各会话独立）。
- 保留 echocap/tiktok-caption-studio 两个旧仓库的 git 历史（新仓库从零开始）。
- 视频字幕场景之外的"任意标签页字幕转写"能力扩展到 TikTok 视频本身之外的更多网站（这属于直播实时场景本来就有的 `<all_urls>` 能力，不是本次新增范围）。
- 商品/购物袋相关功能的任何改动（原样保留，不在本次合并范围内重新设计）。
- 侧边栏"AI 翻译"开关做成除"覆盖当前视频翻译引擎"之外的任何更复杂语义（比如可配置的第三方翻译服务)。

## Further Notes

- 完整的分支决策过程（选项 A/B/C 的取舍理由）记录在这次 `/grilling` 会话的对话历史里；被判定为"hard to reverse + surprising + real trade-off"的三个决定已经单独写成 ADR：`docs/adr/0001`（删 Whisper/微软）、`0002`（视频场景流式转写+播完一轮停止）、`0003`（引入 esbuild）。
- 合并后的领域词汇表在 `CONTEXT.md`（单一 context，因为两个场景现在共享转写/翻译/呈现这三层核心基础设施，判定为一个产品而不是两个需要 `CONTEXT-MAP.md` 分开维护的独立 context）。
- `echocap/` 与 `tiktok-caption-studio/` 两个旧仓库合并完成后保留在磁盘上作为归档参考,不删除、不再维护。
- `echocap/Popup 合并设计.dc.html` 是合并前的旧设计稿副本，与顶层 `capsage/Popup 合并设计.dc.html`（含侧边栏,最新）内容不一致，建议合并完成后清理掉，避免后续被误当成最新设计参考。
