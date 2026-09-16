# 删除 Whisper 转写与微软翻译，转写只用 AssemblyAI、翻译只留两个引擎

合并前，TikTok Caption Studio 在视频没有原生字幕时用 Whisper（`/v1/audio/transcriptions`）转写，翻译引擎在 AI 模型和微软 Azure Translator 之间二选一。合并后，转写来源统一改成 AssemblyAI 实时流（见 ADR-0002），Whisper 这条路径就没有存在的理由了——不再保留作为兜底或备选。翻译引擎收窄成 Chrome 内置 nano（默认）和 AI 模型两个，微软 Azure Translator 整个下线。

## 为什么不保留 Whisper/微软 作为可选项

这不是"删掉旧代码"，是主动收窄产品面：

- 保留 Whisper 意味着 Base URL 网关必须同时支持 `/v1/chat/completions` 和 `/v1/audio/transcriptions` 两个接口——这条限制（DeepSeek 官方 API 等纯聊天网关因此转写会失败）本身就是旧设计的一个已知痛点，AssemblyAI 统一转写之后这条限制直接消失，Base URL 配置只服务于聊天补全场景。
- 保留微软翻译意味着要继续维护一套独立的 Azure Translator 凭证（Key + 区域）、独立的批量翻译代码路径，且用户要理解"三选一"里每个选项的取舍。两个引擎已经能覆盖两种真实需求（本地免费实时 vs 云端更强但批量）,第三个选项边际价值低。

## 后果

- 迁移期没有"从 Whisper 切到 AssemblyAI 有问题就切回去"的退路——这是有意的，两边都在个人开发阶段，没有需要向后兼容的存量用户。
- 现有 `translateWithMicrosoft`、`whisperModel` 设置字段、Azure 相关的 options UI 会被整个删除而不是废弃保留。
- 之后如果需要新增翻译引擎，参照 Chrome 内置（逐句）和 AI 模型（整段批量）已经确立的"两种翻译时机"模式（见 [[CONTEXT.md]] 的翻译引擎/逐句翻译/整段批量翻译），新引擎要明确自己属于哪一种,不能引入第三种时机语义而不重新设计上层调用方。
