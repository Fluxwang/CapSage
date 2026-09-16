import {
  ACCENT_COLOR_STORAGE_KEY,
  AUTO_CAPTION_MODE_STORAGE_KEY,
  CHAT_API_KEY_STORAGE_KEY,
  CHAT_BASE_URL_STORAGE_KEY,
  CHAT_DEFAULTS,
  CHAT_MODEL_STORAGE_KEY,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_VIDEO_TRANSLATION_ENGINE,
  SOURCE_LANGUAGE_STORAGE_KEY,
  STORAGE_KEY,
  TARGET_LANGUAGE,
  TRIGGER_STORAGE_KEY,
  VIDEO_TRANSLATION_ENGINE_STORAGE_KEY,
  sourceLanguageLabel,
} from "./shared/settings.js";

const TOKEN_ENDPOINT = "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60";
let sourceLanguage = DEFAULT_SOURCE_LANGUAGE;

const keyInput = document.getElementById("api-key");
const keyStatus = document.getElementById("key-status");
const modelStatus = document.getElementById("model-status");
const downloadRow = document.getElementById("model-download-row");
const downloadButton = document.getElementById("download-model");
const downloadProgress = document.getElementById("download-progress");
const triggerStatus = document.getElementById("trigger-status");
const saveIndicator = document.getElementById("save-indicator");
const modelHeading = document.getElementById("model-heading");
const chatBaseUrlInput = document.getElementById("chat-base-url");
const chatApiKeyInput = document.getElementById("chat-api-key");
const chatModelInput = document.getElementById("chat-model");
const autoCaptionModeInput = document.getElementById("auto-caption-mode");
const videoTranslationEngineInput = document.getElementById("video-translation-engine");

let availabilityPollTimer = null;
let saveIndicatorTimer = null;

for (const button of document.querySelectorAll("[data-section]")) {
  button.addEventListener("click", () => selectSection(button.dataset.section));
}

function selectSection(name) {
  for (const button of document.querySelectorAll("[data-section]")) {
    button.setAttribute("aria-selected", String(button.dataset.section === name));
  }
  for (const section of document.querySelectorAll("[data-section-panel]")) {
    section.hidden = section.dataset.sectionPanel !== name;
  }
}

function showSaved(message = "已保存") {
  saveIndicator.textContent = message;
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => {
    saveIndicator.textContent = "已保存";
  }, 1800);
}

function applyAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get({
    [TRIGGER_STORAGE_KEY]: "pause",
    [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR,
    [AUTO_CAPTION_MODE_STORAGE_KEY]: "manual",
    [SOURCE_LANGUAGE_STORAGE_KEY]: DEFAULT_SOURCE_LANGUAGE,
    [VIDEO_TRANSLATION_ENGINE_STORAGE_KEY]: DEFAULT_VIDEO_TRANSLATION_ENGINE,
    ...CHAT_DEFAULTS,
  });
  sourceLanguage = stored[SOURCE_LANGUAGE_STORAGE_KEY] || DEFAULT_SOURCE_LANGUAGE;
  renderModelHeading();
  const trigger = stored[TRIGGER_STORAGE_KEY];
  for (const input of document.querySelectorAll('input[name="translate-trigger"]')) {
    input.checked = input.value === trigger;
  }
  triggerStatus.textContent = trigger === "sentence"
    ? "当前：每说完一句就翻译。"
    : "当前：等话轮结束后即时翻译。";

  const accent = stored[ACCENT_COLOR_STORAGE_KEY] || DEFAULT_ACCENT_COLOR;
  applyAccent(accent);
  for (const input of document.querySelectorAll('input[name="accent-color"]')) {
    input.checked = input.value === accent;
  }

  chatBaseUrlInput.value = stored[CHAT_BASE_URL_STORAGE_KEY] || "";
  chatModelInput.value = stored[CHAT_MODEL_STORAGE_KEY] || CHAT_DEFAULTS[CHAT_MODEL_STORAGE_KEY];
  autoCaptionModeInput.value = stored[AUTO_CAPTION_MODE_STORAGE_KEY] || "manual";
  videoTranslationEngineInput.value = stored[VIDEO_TRANSLATION_ENGINE_STORAGE_KEY] || DEFAULT_VIDEO_TRANSLATION_ENGINE;

  const keyData = await chrome.storage.local.get([STORAGE_KEY, CHAT_API_KEY_STORAGE_KEY]);
  keyStatus.textContent = keyData[STORAGE_KEY]
    ? "已保存一个 AssemblyAI Key。重新保存可覆盖。"
    : "尚未保存 Key。填入后点“保存并校验”。";
  chatApiKeyInput.placeholder = keyData[CHAT_API_KEY_STORAGE_KEY]
    ? "已保存一个 API Key；填入新值可覆盖"
    : "sk-…";
}

async function validateAssemblyKey(apiKey) {
  let response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      headers: { Authorization: apiKey },
    });
  } catch (error) {
    return { result: "unverified", message: "网络错误，无法联系 AssemblyAI：" + error.message };
  }
  if (response.ok) return { result: "valid" };
  if (response.status === 401 || response.status === 403) {
    return { result: "invalid", message: "Key 无效（HTTP " + response.status + "）。请检查账号和复制内容。" };
  }
  return { result: "unverified", message: "校验请求异常（HTTP " + response.status + "），暂时无法确认 Key。" };
}

document.getElementById("save-key").addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    keyStatus.textContent = "请先填入 AssemblyAI API Key。";
    return;
  }
  keyStatus.textContent = "校验中（尝试换取临时 token）…";
  const outcome = await validateAssemblyKey(apiKey);
  if (outcome.result === "invalid") {
    keyStatus.textContent = "未保存：" + outcome.message;
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: apiKey });
  keyInput.value = "";
  keyStatus.textContent = outcome.result === "valid"
    ? "Key 有效，已保存。"
    : "已保存，但" + outcome.message;
  showSaved();
});

document.getElementById("clear-key").addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE_KEY);
  keyInput.value = "";
  keyStatus.textContent = "已清除保存的 AssemblyAI Key。";
  showSaved();
});

for (const input of document.querySelectorAll('input[name="translate-trigger"]')) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    await chrome.storage.local.set({ [TRIGGER_STORAGE_KEY]: input.value });
    triggerStatus.textContent = input.value === "sentence"
      ? "已保存：每说完一句就翻译（下次开始转写时生效）。"
      : "已保存：等话轮结束后即时翻译（下次开始转写时生效）。";
    showSaved();
  });
}

for (const input of document.querySelectorAll('input[name="accent-color"]')) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    applyAccent(input.value);
    await chrome.storage.local.set({ [ACCENT_COLOR_STORAGE_KEY]: input.value });
    showSaved();
  });
}

chatBaseUrlInput.addEventListener("change", async () => {
  const value = chatBaseUrlInput.value.trim().replace(/\/$/, "");
  chatBaseUrlInput.value = value;
  await chrome.storage.local.set({ [CHAT_BASE_URL_STORAGE_KEY]: value });
  showSaved();
});
chatModelInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ [CHAT_MODEL_STORAGE_KEY]: chatModelInput.value.trim() });
  showSaved();
});
chatApiKeyInput.addEventListener("change", async () => {
  const value = chatApiKeyInput.value.trim();
  if (!value) return;
  await chrome.storage.local.set({ [CHAT_API_KEY_STORAGE_KEY]: value });
  chatApiKeyInput.value = "";
  chatApiKeyInput.placeholder = "已保存一个 API Key；填入新值可覆盖";
  showSaved();
});
autoCaptionModeInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ [AUTO_CAPTION_MODE_STORAGE_KEY]: autoCaptionModeInput.value });
  showSaved();
});
videoTranslationEngineInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ [VIDEO_TRANSLATION_ENGINE_STORAGE_KEY]: videoTranslationEngineInput.value });
  showSaved();
});

function languagePair() {
  return { sourceLanguage, targetLanguage: TARGET_LANGUAGE };
}

function renderModelHeading() {
  modelHeading.textContent = sourceLanguageLabel(sourceLanguage) + " → 简体中文翻译模型";
}
function renderModelStatus(text, { downloadable = false } = {}) {
  modelStatus.textContent = text;
  downloadRow.hidden = !downloadable;
  if (!downloadable) {
    downloadProgress.hidden = true;
    downloadButton.disabled = false;
  }
}

function pollUntilAvailabilitySettles() {
  if (availabilityPollTimer) return;
  availabilityPollTimer = setInterval(async () => {
    const availability = await Translator.availability({
      ...languagePair(),
    });
    if (availability !== "downloading") {
      clearInterval(availabilityPollTimer);
      availabilityPollTimer = null;
      refreshModelStatus();
    }
  }, 3000);
}

async function refreshModelStatus() {
  if (!("Translator" in self)) {
    renderModelStatus(
      "当前浏览器不支持内置翻译（没有 Translator API）。EchoSage 没有直播实时的云端翻译兜底；可用浏览器：Chrome 138+ / Edge 148+。"
    );
    return;
  }
  const availability = await Translator.availability({
    ...languagePair(),
  });
  switch (availability) {
    case "available":
      renderModelStatus(sourceLanguageLabel(sourceLanguage) + " → 简体中文翻译模型已就绪。");
      break;
    case "downloadable":
      renderModelStatus("模型支持但尚未下载。点击下方按钮开始下载。", { downloadable: true });
      break;
    case "downloading":
      renderModelStatus("模型正在下载中，完成后这里会自动更新。");
      pollUntilAvailabilitySettles();
      break;
    default:
      renderModelStatus("当前设备或这个语言对不可用。请检查浏览器版本、磁盘空间和本地模型支持情况。");
  }
}

downloadButton.addEventListener("click", async () => {
  downloadButton.disabled = true;
  downloadProgress.hidden = false;
  modelStatus.textContent = "下载中…";
  try {
    const translator = await Translator.create({
      ...languagePair(),
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = Math.round(event.loaded * 100);
          downloadProgress.value = percent;
          modelStatus.textContent = "模型下载中：" + percent + "%";
        });
      },
    });
    translator.destroy();
    renderModelStatus("翻译模型已下载并就绪。");
  } catch (error) {
    modelStatus.textContent = "下载失败：" + error.name + ": " + error.message;
    downloadButton.disabled = false;
    downloadProgress.hidden = true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SOURCE_LANGUAGE_STORAGE_KEY]) return;
  sourceLanguage = changes[SOURCE_LANGUAGE_STORAGE_KEY].newValue || DEFAULT_SOURCE_LANGUAGE;
  renderModelHeading();
  refreshModelStatus();
});
window.addEventListener("unload", () => {
  if (availabilityPollTimer) clearInterval(availabilityPollTimer);
});

loadSettings().then(refreshModelStatus).catch(() => refreshModelStatus());
