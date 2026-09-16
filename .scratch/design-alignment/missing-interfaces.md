# 设计稿落地后仍缺的接口

**What this is:** 按 Claude Design 项目 `EchoCap与TikTok Caption合并` 的设计稿把前端（popup / 设置页 / 页内侧边栏 / 悬浮层）改完之后，剩下这些**设计稿要求、但后端管线还不支持**的接口。UI 已经就位并把用户选择写进了 `chrome.storage.local`，缺的是把这些值消费掉的那一段。

**Status:** ready-for-human

**设计稿来源：** 设计项目里的 `EchoSage Popup 合并设计 - 独立版.html` 超出 MCP `get_file` 的 256 KiB 上限，取不全；实际对照的是仓库根、同一设计项目里的 `Popup 合并设计.dc.html`（`CLAUDE.md` 指明这份是最新、含侧边栏的那份）。两份画的是同一套界面。

---

## 1. 译文语言（`targetLanguage`）没有贯通到转写/翻译管线 —— 最大的一个

设计稿的直播实时、视频字幕、侧边栏三处都有「译」下拉。UI 已实现：值存在 `targetLanguage` 键里（默认 `zh`），三处联动，`Translator.availability()` 的可用性判断也已经按它走。**但真正建 Translator 的地方仍然写死中文。**

- `offscreen.js` 用 `shared/settings.js` 的常量 `TARGET_LANGUAGE`（= `"zh"`）建 translator：`translatorPair()`（约 382 行）、可用性报错文案（约 397 行）、`Translator.create`（约 427 行）、`VideoTranslationLedger` 的 pair（约 845 行）。
- offscreen document 里**没有 `chrome.storage`**（`offscreen.js` 第 42 行的不变量），所以它不能自己去读。

**需要的接口改动：**

| 消息 | 发出方 | 要新增的字段 |
| --- | --- | --- |
| `start-capture` | `background.js` → offscreen | `targetLanguage` |
| `start-video-capture` | `background.js` → offscreen | `targetLanguage` |
| `translate-video-units` | content → offscreen | `targetLanguage`（或沿用会话里存的那份） |
| `translate-video-captions` | content/popup → `background.js` | `targetLanguage` |
| `video-chat` | content → `background.js` | `targetLanguage`（总结/仿写的输出语言） |

`background.js` 已经在读 storage 拿 API Key，顺手把 `targetLanguage` 一起读出来传下去即可。`generateVideoText()` 和 `translateVideoCaptions()` 的 prompt 里「翻译成中文」也要参数化。

**不做这件事的后果：** 下拉能选、能存、设置页的模型下载会按新语言对走，但实际译文仍然是中文——一个会骗人的控件。

---

## 2. 「双语字幕」开关没接到悬浮层

设计稿直播实时 Tab 的开关，右边写着「叠加在画面下方」——它管的是**悬浮层**要不要同时显示原文轨。

- 已实现：`bilingual` 键；popup 的实时转写列表、视频字幕列表、侧边栏字幕列表都已按它渲染。
- 未实现：`content-overlay.js` 永远同时渲染 `.source` 和 `.translation`。

**需要的接口改动：** 二选一——
- `background.js` 的 `subtitle-start` / `subtitle-update` 消息带上 `bilingual`，overlay 据此隐藏 `.source`；或
- overlay 自己读 `chrome.storage.local` 的 `bilingual` 并监听 `onChanged`（它是隔离世界的 content script，有 storage 权限；我已经用这个办法给它接了强调色，可照抄）。

注意 ADR-0002 的降级形态：**没有译文时原文轨必须升为主视觉**，所以「关掉双语」只能隐藏「已有译文的那一行的原文」，不能无条件隐藏原文。

---

## 3. 「启用 AssemblyAI 转写」开关没有被消费（新增键）

设计稿视频字幕分区新增的复选框：「启用 AssemblyAI 转写（无原生字幕时录音并转写，会调用 AssemblyAI API）」。这是 ADR-0005「花钱保险丝」在 UI 上的落点，和「切换到新视频时」正交——自动档位只决定**何时**触发，这个开关决定**允不允许**触发。

- 已实现：`videoAsrEnabled` 键（默认 `false`），设置页可改。
- 未实现：没人读它。

**需要的接口改动：**
- `content-tiktok.js`：`startStreaming()` 和 `maybeAutoRun()` 在开关关闭时直接拒绝，并把原因写进 `workspaceStatus`（「未启用 AssemblyAI 转写，请到设置页打开」）；侧边栏的「开始流式转写」按钮相应置灰。
- `background.js`：`start-video-capture` 里再挡一道（content script 可被页面脚本干扰，花钱的闸不能只有一道）。

---

## 4. 「AssemblyAI 模型」字段没有被消费（新增键）

设计稿把它和聊天模型并列放在「AI 接口」网格里，默认 `universal`。

- 已实现：`asrModel` 键，设置页可改。
- 未实现：`offscreen.js` 连 AssemblyAI v3 时的 model 参数仍是写死的。

**需要的接口改动：** 和第 1 项同一条路径——`background.js` 读 `asrModel`，随 `start-capture` / `start-video-capture` 传给 offscreen，offscreen 拼到 WebSocket 的查询参数里。

---

## 5. 「切换到新视频时 = 自动」的行为和设计稿文案不一致

设计稿的橙色警告写的是「**自动录制 30 秒**标签页音频并调用 AssemblyAI」。当前实现（ADR-0009）是**播完一轮就停**，没有 30 秒这个概念。

这是文案和实现的分歧，需要**你来定**：
- 若以 ADR-0009 为准 → 我把设计稿那句话改成「自动录制这一轮播放的音频」。
- 若以设计稿为准 → 需要给视频流式转写加一个 30 秒硬上限（和「播完一轮」取先到者），ADR-0009 要补一条修订。

我这次**按 ADR-0009 的实现没动**，只保留了设计稿的原文案——所以现在设置页那句话是不准的，等你定。

---

## 6. popup 的「翻译字幕」「重新检测」依赖新增的转发消息

设计稿视频字幕 Tab 上这两个按钮原来没有通路。我加了最小的一条：

- `popup.js` → `chrome.runtime.sendMessage({ type: "video-command", command })`
- `background.js` 转发给当前标签页（`handleVideoMessage` 的 `video-command` 分支）
- `content-tiktok.js` 的 `handleVideoCommand()` 执行：`load-captions` 走 `loadCaptions()`，`redetect` 清掉 `activeVideoId` 后重扫

**限制：** 只有 TikTok 页有这个 content script，其他站点上这两个按钮会返回失败并提示。如果希望「视频字幕」场景覆盖非 TikTok 站点，需要另一条通用的字幕轨探测通路（不在本次范围内，也不在 spec 里）。

---

## 7. 视频卡片的「时长 · 字幕轨语言」只在有原生数据时才准

设计稿视频卡片第二行是 `00:09 · 检测到英文字幕轨`。我从 TikTok 的 item 里补了两个字段（`content-tiktok.js` 的 `items.set`）：`duration` 和 `subtitleLanguage`，并在 `publishState()` 里以 `nativeCaptionLanguage` 发出。

**仍然不准的情况：** 流式转写场景（没有原生字幕轨）拿不到 TikTok 的 `video.duration`，会显示 `--:--`。要补的话可以从页面里的 `<video>` 元素读 `duration`（`sampleVideoPlayback` 已经在碰那个元素了），但这属于额外取数，没做。

---

## 8. 「关于」页的三个链接还是占位

`更新日志` / `反馈问题` / `隐私说明` 目前分别指向 `docs/adr/0010-…md`、`mailto:feedback@echosage.local`、`CONTEXT.md`。设计稿没给真实地址，需要你提供。

---

## 顺带记一下这次改了什么（不是缺口，是已完成的变更）

- **强调色从十六进制换成设计稿的 oklch 值**（`oklch(0.58 0.14 195)` 等四色）。`shared/settings.js` 里新增 `normalizeAccentColor()` 做旧值迁移，所以已经存了 `#168ea3` 的用户不会掉到「一颗都没选中」的状态。
- **模型下载进度走了一趟 storage**（新键 `translatorDownloadProgress`）。设计稿的 popup 里有一张下载进度卡，但下载只能由设置页的按钮点击触发（Translator API 的硬要求），popup 监听不到那个 `monitor` 事件——所以设置页把百分比写进 storage，popup 订阅它，下载结束删键。
- **悬浮层加了译文轨底部那条 2px 强调色线**（设计稿「效果预览」里有）。白字黑底的铁律没动，强调色只落在那条线上，不去改字色。
- **修了两个真 bug**：侧边栏两个子页的 `.is-hidden` 被 `[data-side-view]` 的 `display:grid/flex` 盖住，切页时旧页不会隐藏；以及逐条翻译走的是增量更新、不走 `render()`，底栏那行「N / M 句已翻译」一直停在开始时的数字。
