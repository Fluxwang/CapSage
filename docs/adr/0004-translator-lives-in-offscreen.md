# Translator 实例住在 Offscreen Document

翻译在 offscreen document 里进行，与 ASR 共用同一个长生命周期的 context。content script 只负责渲染字幕，不含任何翻译逻辑。

## 为什么这需要一个决定

`Translator.create()` 规范上要求 **transient user activation**（瞬时用户激活，约 5 秒有效期）。offscreen 是隐藏文档，用户永远点不到它，理论上拿不到激活；而 background service worker 更不可能——Translator API 在 Worker 里根本不可用。按规范文本读，唯一可行的位置似乎只剩 content script，靠页面上的真实点击拿激活。

实测推翻了这个推论。在 offscreen 里（`navigator.userActivation.isActive === false`、`hasBeenActive === false`，已确认无激活）调用 `create()` **成功**，翻译也正常。同时确认了翻译模型是**跨 context 共享**的：在 popup 里下载完，offscreen 读到的 `availability()` 直接是 `available`。

再进一步实测（先从 `chrome://on-device-translation-internals/` 卸载语言包，再在无激活状态下调用）拿到了 Chrome 自己给出的规则，比任何文档都精确：

> `NotAllowedError: Requires a user gesture when availability is "downloading" or "downloadable".`

即：**用户手势的门槛卡在「触发下载」，不卡在「使用已就绪的模型」。**

| `availability()` | offscreen 能否 `create()` |
| --- | --- |
| `available` | ✅ 不需要手势 |
| `downloadable` / `downloading` | ❌ 必须有用户手势 |

## 为什么不放在 content script

content script 确定能拿到激活，但生命周期跟着页面走。TikTok 是 SPA，切直播间时实例要重建；每个 tab 还各持一份实例。翻译状态和 ASR 状态被拆到两个生命周期不同的 context 里，联调阶段会持续产生竞态类的 bug。

放在 offscreen 则天然和捕获会话同生死，状态管理简单，且 content script 得以保持为纯渲染层。

## 后果

- **`availability() === "available"` 是启动捕获的前置条件，必须每次都查，不是一次性的引导。** 模型不是下载一次就永久存在：用户随时可以从 `chrome://on-device-translation-internals/` 卸载语言包（我们自己就这么干过），Chrome 在磁盘空间紧张时也会清理。所以每次启动捕获前都查，不是 `available` 就阻塞并引导用户去下载，而不是直接失败、或让 offscreen 撞上 `NotAllowedError`。
- **模型下载只能发生在有用户手势的 context 里**（popup 或 options 页的按钮点击）。offscreen 永远下不了模型，只能消费已就绪的模型。下载可能要几分钟，所以那个入口必须用 `monitor` 展示下载进度，否则用户会以为卡死了。
- content script 收到的是**已经翻译好的中文**，它不知道 Translator 的存在。
- 「点击启用字幕」这个交互如果保留，是作为字幕开关，不再承担提供用户激活的职责。
