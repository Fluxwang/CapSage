# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 这个仓库是什么

`capsage` 是一个个人工作目录，包含两个**相互独立、互不相关的 Chrome 扩展**，各自是独立的 git 仓库，拥有各自的历史记录。两者之间没有共享的代码、构建系统或工具链——请将它们视为恰好放在同一目录下的两个独立项目。这个顶层目录本身不是 git 仓库。

- `echocap/` — 面向 TikTok Live（以及其他标签页音频）的实时西班牙语→中文直播字幕悬浮层。
- `tiktok-caption-studio/` — TikTok 视频详情页工具，用于字幕、翻译、摘要以及橱窗链接展示。

请始终在相应子项目目录内运行命令，而不是在此根目录下运行。

## echocap/

一个 Chrome 扩展（MV3），捕获标签页音频，通过 AssemblyAI 实时转写西班牙语语音，在设备端（Chrome 内置 Translator API / Gemini Nano）将其翻译为中文，并以浮动的双轨字幕悬浮层形式渲染。

**该子项目有自己的 `CLAUDE.md`，位于 `echocap/CLAUDE.md`——在改动其代码之前，请先阅读该文件了解命令、架构、MV3 离屏文档（offscreen document）/AudioWorklet 设计以及非显而易见的不变量。** 它还有 `echocap/CONTEXT.md`（领域词汇表）和 `echocap/docs/adr/`（编号的架构决策记录）——在此进行架构层面的改动之前请先查阅这些文件。

注意：`echocap/AGENT.md` 是早期版本 `echocap/CLAUDE.md` 的过时副本（早于 AssemblyAI/双 AudioContext 相关工作）——请优先参考 `echocap/CLAUDE.md`。

## tiktok-caption-studio/

一个 Chrome 扩展（MV3，无构建步骤——直接加载纯 JS/HTML/CSS，没有 `package.json`，未配置 lint/test 工具链），运行于 TikTok 视频页面上。它展示封面图和互动数据，展示 TikTok 橱窗商品链接，获取/转写字幕，翻译字幕，并通过兼容 OpenAI 的 API 生成摘要/改写内容。

手动测试时加载未打包扩展：`chrome://extensions` → 启用开发者模式 → "加载已解压的扩展程序" → 选择 `tiktok-caption-studio/`。

### 架构

- **`inject.js`** 在页面的 MAIN world 中于 `document_start` 阶段运行。它对 `window.fetch` 和 `XMLHttpRequest.prototype.open` 打补丁，以拦截 TikTok 自身的 `/api/item|recommend|post|related|search|...` 响应（以及首次加载时的 `__UNIVERSAL_DATA_FOR_REHYDRATION__` 水合数据块），并通过 `postMessage` 将解析后的视频记录发送给 `content.js`。这样做是必要的，因为 TikTok 的水合数据只覆盖首个展示的视频——后续视频（信息流滚动、应用内导航）只出现在各自的 API 响应中。商品数据是从 `item.anchors[n].extra` 中嵌套的二次 JSON 编码数据块中解出的。
- **`content.js`** 在隔离世界（isolated world）中于 `document_idle` 阶段运行。它负责页内 UI（封面/数据卡片、字幕抽屉、商品弹出层），跟踪"当前活跃"视频 id（存在 `/video/<id>` URL 时以其为准，否则以视口内正在播放且占比最大的 `<video>` 所在卡片为准），并驱动字幕获取 → 翻译 → 摘要/改写这条流程。自动行为（自动获取字幕 / 视频切换时自动获取并翻译）由 `autoCaptionMode` 设置项控制。
- **`background.js`**（MV3 service worker）是唯一被允许调用外部 API 并持有兼容 OpenAI 的 `apiKey` 的部分。它负责聊天补全（摘要/改写/AI 翻译）、Whisper 转写（`/v1/audio/transcriptions`）、微软/Azure Translator 调用、原生字幕获取，以及标签页音频录制的编排。工具栏按钮通过消息切换 `content.js` 中的页内面板，或在非 TikTok 页面打开选项页；如果内容脚本尚未加载（扩展在页面加载后安装/重载），则回退为使用 `chrome.scripting.executeScript`/`insertCSS`。
- **`offscreen.js`** 的存在纯粹是因为 MV3 service worker 没有 `MediaRecorder`/`getUserMedia`。`background.js` 按需创建离屏文档（`ensureOffscreen`），并通过 `chrome.runtime.sendMessage({ type: "offscreen-record", streamId, duration })` 让它录制标签页音频（`tabCapture` 流 → `MediaRecorder`，时长上限 3 秒–120 秒），并返回原始字节数据以上传给 Whisper。
- **字幕来源优先级**：优先使用原生 WebVTT 字幕（`video.claInfo`/`subtitleInfos`）；若该视频类型没有原生字幕轨道，"获取字幕"会录制 30 秒的标签页音频并发送给 `/v1/audio/transcriptions`，使用 `verbose_json` 分段输出。自动获取模式会在无需点击的情况下触发此录制（以及随之产生的费用）——详见设置项说明。
- **翻译**功能在设置中可在两种引擎间切换，二者没有共享代码路径："AI model" 要求聊天模型在一次调用中返回一个 JSON 格式的翻译字符串数组（`background.js` 中的 `translateWithAi`）；"Microsoft" 将原始字幕数组批量发送给 Azure Translator 的 `/translate`（`translateWithMicrosoft`），速度更快且不受 LLM JSON 解析失败的影响，但需要单独的 Azure Translator 资源/密钥（若非 Global 资源，还需要区域信息）。
- 所配置的 Base URL 必须同时提供 `/v1/chat/completions` 和 `/v1/audio/transcriptions` 服务——例如 DeepSeek 官方 API 只提供前者，因此若不搭配一个兼容 Whisper 的网关，转写功能将无法使用。

`lib/`、`sidepanel/` 和 `tests/` 目前只是占位空目录——尚无任何代码。
