# 用两个 AudioContext 分离回放链路与转写链路

> **已验证（2026-08-18）**：双 AudioContext 共用同一个 MediaStream 在实践中稳定——16kHz 转写链路稳定产出音频块、音量正常跳动、默认采样率回放链路同时运行。下方「唯一未验证假设」的退路（全程 48kHz + 服务端重采样）确认不需要。

`tabCapture` 会静音原标签页，所以 offscreen 必须自己把音频接回 `destination` 才能让用户听到直播原声——回放不是可选功能，是必需链路。同时 AssemblyAI 流式接口的默认采样率是 16kHz，浏览器 Web Audio 默认在 48kHz。

我们不把整个 offscreen 收敛到单个 16kHz 的 AudioContext，而是建两个，共用同一个 `MediaStream`：

- **回放链路**：默认采样率（通常 48kHz）的 AudioContext，`source → destination`，保真还原原声
- **转写链路**：`new AudioContext({ sampleRate: 16000 })`，`source → AudioWorkletNode → gain(0) → destination`，产出 16kHz PCM16 发给 AssemblyAI

## 为什么不是更简单的方案

**单个 16kHz AudioContext**（最少代码）：用户听到的直播原声会被一并砍到 8kHz 带宽，人声变闷、背景音乐像 AM 电台。回放降级是听得出来的，不能接受。

**全程 48kHz，给 AssemblyAI 传 `sample_rate=48000`**：音质上与本方案等价（`sample_rate` 接受 8000–96000，服务端自己会降到 16kHz，声学模型本来就只吃 16kHz）。纯粹因为上行带宽从 32 KB/s 涨到 96 KB/s 而不选。这是本方案唯一的真实收益——如果将来带宽不再是考虑因素，退回单个 48kHz context 是完全正当的简化。

**在 AudioWorklet 里自己写 48→16 降采样**：48000/16000 是整数 3:1，看着很诱人，但必须自己实现抗混叠低通。写漏了就是混叠——8kHz 以上的能量折回语音频带变成宽带噪声，直接拉低识别率，而且音量表上完全看不出来。Chrome 的 AudioContext 内部已经有 sinc 重采样器，没有理由自己重写一遍。

## 后果

- 转写链路里的 AudioWorkletNode **必须**有一条通向 `destination` 的路径（挂 `gain(0)` 静音即可）。Web Audio 是拉取模型，死胡同节点永远不会被驱动——`offscreen.js` 里的 AnalyserNode 已经踩过一次同样的坑。
- 两个 context 的生命周期要一起管理：start 时一起建，stop / `unload` 时一起 `close()`。
- 看到「两个 AudioContext」不要合并。合并 = 回放降级，这是刻意的分离。
