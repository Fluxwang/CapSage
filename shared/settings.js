// 扩展各 context（popup / options / content / background / offscreen）共享的常量。
// 不放 core/——那里是纯领域逻辑，不持有扩展侧的存储细节。
export const STORAGE_KEY = "assemblyaiApiKey";

// 译文触发时机的设置键。取值是 core/session.js 的 TRANSLATE_TRIGGER
// ("pause" | "sentence")；未设置时按 pause 处理（保持原有行为）。
export const TRIGGER_STORAGE_KEY = "translateTrigger";

// 视频字幕场景使用的 OpenAI 兼容聊天接口。它只服务于总结、仿写，以及
// 后续的整段批量翻译；不承担任何音频转写职责。
export const CHAT_BASE_URL_STORAGE_KEY = "chatBaseUrl";
export const CHAT_API_KEY_STORAGE_KEY = "chatApiKey";
export const CHAT_MODEL_STORAGE_KEY = "chatModel";

// AssemblyAI 的转写模型名。设计稿把它和聊天模型并列放在「AI 接口」里，
// 因为两者都是「往外打的接口参数」，而不是场景开关。
export const ASR_MODEL_STORAGE_KEY = "asrModel";
export const DEFAULT_ASR_MODEL = "universal";

export const CHAT_DEFAULTS = {
  [CHAT_BASE_URL_STORAGE_KEY]: "",
  [CHAT_API_KEY_STORAGE_KEY]: "",
  [CHAT_MODEL_STORAGE_KEY]: "gpt-4o-mini",
  [ASR_MODEL_STORAGE_KEY]: DEFAULT_ASR_MODEL,
};

export const AUTO_CAPTION_MODE_STORAGE_KEY = "autoCaptionMode";
export const ACCENT_COLOR_STORAGE_KEY = "accentColor";

// 视频字幕场景的总开关：没有原生字幕时是否允许录音 + 调 AssemblyAI。
// 它和「切换到新视频时」正交——自动档位只决定何时触发，这个开关决定
// 允不允许触发（ADR-0005 花钱保险丝在 UI 上的落点）。
export const VIDEO_ASR_ENABLED_STORAGE_KEY = "videoAsrEnabled";
export const DEFAULT_VIDEO_ASR_ENABLED = false;

export const DEFAULT_ACCENT_COLOR = "oklch(0.58 0.14 195)";

export const ACCENT_COLORS = [
  { value: "oklch(0.58 0.14 195)", label: "青蓝（默认）" },
  { value: "oklch(0.55 0.16 285)", label: "靛紫" },
  { value: "oklch(0.6 0.16 150)", label: "翠绿" },
  { value: "oklch(0.6 0.17 25)", label: "朱红" },
];

// 旧版本存的是十六进制值。颜色本身仍然能用（CSS 照样认），但选色卡要能
// 高亮出对应那一颗，所以这里做一次就地归一。
const LEGACY_ACCENT_COLORS = {
  "#168ea3": "oklch(0.58 0.14 195)",
  "#5d55c7": "oklch(0.55 0.16 285)",
  "#238b5d": "oklch(0.6 0.16 150)",
  "#c65b3f": "oklch(0.6 0.17 25)",
};

export function normalizeAccentColor(value) {
  if (!value) return DEFAULT_ACCENT_COLOR;
  return LEGACY_ACCENT_COLORS[value.toLowerCase()] ?? value;
}

export const SOURCE_LANGUAGE_STORAGE_KEY = "sourceLanguage";
export const DEFAULT_SOURCE_LANGUAGE = "es";

// 译文语言。直播实时和视频字幕共用一份（设计稿里两个 Tab 的「译」下拉
// 是同一个值），默认简体中文。TARGET_LANGUAGE 保留给只认默认值的旧调用。
export const TARGET_LANGUAGE_STORAGE_KEY = "targetLanguage";
export const DEFAULT_TARGET_LANGUAGE = "zh";
export const TARGET_LANGUAGE = DEFAULT_TARGET_LANGUAGE;

// 双语呈现开关。直播实时（悬浮层是否同时显示原文轨）和视频字幕
// （对照列表是否显示原文）共用这一个键。
export const BILINGUAL_STORAGE_KEY = "bilingual";
export const DEFAULT_BILINGUAL = true;

export const VIDEO_TRANSLATION_ENGINE_STORAGE_KEY = "videoTranslationEngine";
export const DEFAULT_VIDEO_TRANSLATION_ENGINE = "builtin";

export const SOURCE_LANGUAGES = [
  { value: "es", label: "西班牙语" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "pt", label: "葡萄牙语" },
];

export const TARGET_LANGUAGES = [
  { value: "zh", label: "简体中文" },
  { value: "zh-Hant", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
];

export function sourceLanguageLabel(value) {
  return SOURCE_LANGUAGES.find((language) => language.value === value)?.label ?? value;
}

export function targetLanguageLabel(value) {
  return TARGET_LANGUAGES.find((language) => language.value === value)?.label ?? value;
}

// 内置翻译模型的下载进度（0–100）。下载只能由设置页的按钮点击触发
// （Translator API 的硬要求），但 popup 需要显示同一条进度，所以设置页
// 把进度写进 storage，popup 订阅它。下载结束时这个键被删掉。
export const TRANSLATOR_PROGRESS_STORAGE_KEY = "translatorDownloadProgress";
