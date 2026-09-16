// 扩展各 context（options / background / offscreen）共享的常量。
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

export const CHAT_DEFAULTS = {
  [CHAT_BASE_URL_STORAGE_KEY]: "",
  [CHAT_API_KEY_STORAGE_KEY]: "",
  [CHAT_MODEL_STORAGE_KEY]: "gpt-4o-mini",
};

export const AUTO_CAPTION_MODE_STORAGE_KEY = "autoCaptionMode";
export const ACCENT_COLOR_STORAGE_KEY = "accentColor";

export const DEFAULT_ACCENT_COLOR = "#168ea3";

export const SOURCE_LANGUAGE_STORAGE_KEY = "sourceLanguage";
export const DEFAULT_SOURCE_LANGUAGE = "es";
export const TARGET_LANGUAGE = "zh";
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

export function sourceLanguageLabel(value) {
  return SOURCE_LANGUAGES.find((language) => language.value === value)?.label ?? value;
}
