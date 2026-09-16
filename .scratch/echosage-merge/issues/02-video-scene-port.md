# 02 — 视频字幕场景迁移（Whisper 与微软翻译不迁移）

**What to build:** popup 出现第二个 Tab"视频字幕"。打开 TikTok 视频页，能看到封面/互动数据卡片、拉取并展示原生 WebVTT 字幕、翻译字幕、生成总结与仿写、查看商品链接——前身 tiktok-caption-studio 的体验原样可用，只是和直播实时共处一个扩展、一个图标。没有原生字幕的视频这一票**明确不做兜底**，直接显示"无字幕"，兜底留给 06。

**Blocked by:** 01（共用 manifest、构建流水线与 `shared/`）

**Status:** resolved

来源材料是工作目录里的 `tiktok-caption-studio/`（嵌套的独立 git 仓库，不被本仓库跟踪）。

- [x] 三个 content script 入口按 spec 就位：`inject.js`（TikTok-only、MAIN world、`document_start`、不进 bundle）、`content-tiktok.js`（TikTok-only、隔离世界）、`content-overlay.js`（`<all_urls>`、隔离世界，01 已建立）
- [x] TikTok 页面上 `content-tiktok.js` 与 `content-overlay.js` 同时加载、各自独立工作，互不干扰
- [x] 原生 WebVTT 字幕的拉取与展示可用；"当前活跃视频"追踪行为与前身一致
- [x] 没有原生字幕轨的视频显示明确的"无字幕"状态，**不触发任何转写**
- [x] 总结、仿写、商品/购物袋（封面图标悬停预览、"查看商品"）与前身行为一致
- [x] Whisper 相关的一切（`whisperModel` 设置、`/v1/audio/transcriptions` 调用、"Base URL 需同时支持两个接口"的限制与提示文案）**不出现在新仓库任何位置**——是迁移时跳过，不是搬过来再删（ADR-0008）
- [x] 微软 Azure Translator 相关的一切（`translateWithMicrosoft`、Azure Key/区域设置项与 UI）同样不迁移
- [x] 迁移完成后，新代码不再从 `tiktok-caption-studio/` 目录引用任何文件

## Answer

TikTok 页面入口、原生 WebVTT 读取、视频卡片和商品预览已迁入。无原生字幕时默认只显示状态，后续由 06 的手动或自动流式路径接管；旧 Whisper、Azure 与旧仓库引用均未带入。
