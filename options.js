import {
  ACCENT_COLORS,
  ACCENT_COLOR_STORAGE_KEY,
  ASR_MODEL_STORAGE_KEY,
  AUTO_CAPTION_MODE_STORAGE_KEY,
  CHAT_API_KEY_STORAGE_KEY,
  CHAT_BASE_URL_STORAGE_KEY,
  CHAT_DEFAULTS,
  CHAT_MODEL_STORAGE_KEY,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_ASR_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  DEFAULT_VIDEO_ASR_ENABLED,
  DEFAULT_VIDEO_TRANSLATION_ENGINE,
  SOURCE_LANGUAGE_STORAGE_KEY,
  STORAGE_KEY,
  TARGET_LANGUAGE_STORAGE_KEY,
  TRANSLATOR_PROGRESS_STORAGE_KEY,
  TRIGGER_STORAGE_KEY,
  VIDEO_ASR_ENABLED_STORAGE_KEY,
  VIDEO_TRANSLATION_ENGINE_STORAGE_KEY,
  normalizeAccentColor,
  sourceLanguageLabel,
  targetLanguageLabel,
} from "./shared/settings.js";

const TOKEN_ENDPOINT = "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60";

const $ = (id) => document.getElementById(id);

const keyInput = $("api-key");
const keyStatus = $("key-status");
const modelHeading = $("model-heading");
const modelCallout = $("model-callout");
const modelStatus = $("model-status");
const downloadButton = $("download-model");
const downloadProgress = $("download-progress");
const downloadProgressBar = $("download-progress-bar");
const triggerStatus = $("trigger-status");
const saveIndicator = $("save-indicator");
const chatBaseUrlInput = $("chat-base-url");
const chatApiKeyInput = $("chat-api-key");
const chatModelInput = $("chat-model");
const asrModelInput = $("asr-model");
const autoCaptionModeInput = $("auto-caption-mode");
const videoTranslationEngineInput = $("video-translation-engine");
const videoAsrEnabledInput = $("video-asr-enabled");
const accentSwatches = $("accent-swatches");

let sourceLanguage = DEFAULT_SOURCE_LANGUAGE;
let targetLanguage = DEFAULT_TARGET_LANGUAGE;
let availabilityPollTimer = null;
let saveIndicatorTimer = null;

$("about-version").textContent = `v${chrome.runtime.getManifest().version} · EchoSage`;
renderAccentSwatches();

/* ---------------- 分区切换 ---------------- */

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

// 设计稿右上角常驻「修改即时保存」；保存瞬间才换成具体回执，随后复位。
function showSaved(message = "已保存") {
  saveIndicator.textContent = message;
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => {
    saveIndicator.textContent = "修改即时保存";
  }, 1800);
}

/* ---------------- 强调色 ---------------- */

function renderAccentSwatches() {
  accentSwatches.replaceChildren(...ACCENT_COLORS.map(({ value, label }) => {
    const swatch = document.createElement("label");
    swatch.className = "swatch";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "accent-color";
    input.value = value;
    const disc = document.createElement("span");
    disc.className = "disc";
    disc.style.background = value;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = label;
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      applyAccent(value);
      await chrome.storage.local.set({ [ACCENT_COLOR_STORAGE_KEY]: value });
      showSaved();
    });
    swatch.append(input, disc, name);
    return swatch;
  }));
}

function applyAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
}

/* ---------------- 读取设置 ---------------- */

async function loadSettings() {
  const stored = await chrome.storage.local.get({
    [TRIGGER_STORAGE_KEY]: "pause",
    [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR,
    [AUTO_CAPTION_MODE_STORAGE_KEY]: "manual",
    [SOURCE_LANGUAGE_STORAGE_KEY]: DEFAULT_SOURCE_LANGUAGE,
    [TARGET_LANGUAGE_STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE,
    [VIDEO_TRANSLATION_ENGINE_STORAGE_KEY]: DEFAULT_VIDEO_TRANSLATION_ENGINE,
    [VIDEO_ASR_ENABLED_STORAGE_KEY]: DEFAULT_VIDEO_ASR_ENABLED,
    ...CHAT_DEFAULTS,
  });
  sourceLanguage = stored[SOURCE_LANGUAGE_STORAGE_KEY] || DEFAULT_SOURCE_LANGUAGE;
  targetLanguage = stored[TARGET_LANGUAGE_STORAGE_KEY] || DEFAULT_TARGET_LANGUAGE;
  renderModelHeading();

  const trigger = stored[TRIGGER_STORAGE_KEY];
  for (const input of document.querySelectorAll('input[name="translate-trigger"]')) {
    input.checked = input.value === trigger;
  }
  triggerStatus.textContent = trigger === "sentence"
    ? "当前：每说完一句就翻译。"
    : "当前：等主播停顿后整段翻译（默认）。";

  const accent = normalizeAccentColor(stored[ACCENT_COLOR_STORAGE_KEY]);
  applyAccent(accent);
  for (const input of document.querySelectorAll('input[name="accent-color"]')) {
    input.checked = input.value === accent;
  }

  chatBaseUrlInput.value = stored[CHAT_BASE_URL_STORAGE_KEY] || "";
  chatModelInput.value = stored[CHAT_MODEL_STORAGE_KEY] || CHAT_DEFAULTS[CHAT_MODEL_STORAGE_KEY];
  asrModelInput.value = stored[ASR_MODEL_STORAGE_KEY] || DEFAULT_ASR_MODEL;
  autoCaptionModeInput.value = stored[AUTO_CAPTION_MODE_STORAGE_KEY] || "manual";
  videoTranslationEngineInput.value = stored[VIDEO_TRANSLATION_ENGINE_STORAGE_KEY] || DEFAULT_VIDEO_TRANSLATION_ENGINE;
  videoAsrEnabledInput.checked = Boolean(stored[VIDEO_ASR_ENABLED_STORAGE_KEY]);

  const keyData = await chrome.storage.local.get([STORAGE_KEY, CHAT_API_KEY_STORAGE_KEY]);
  keyStatus.textContent = keyData[STORAGE_KEY]
    ? "已保存一个 AssemblyAI Key。重新保存可覆盖。"
    : "尚未保存 Key。填入后点「保存并校验」。";
  chatApiKeyInput.placeholder = keyData[CHAT_API_KEY_STORAGE_KEY]
    ? "已保存一个 API Key；填入新值可覆盖"
    : "sk-…";
}

/* ---------------- AssemblyAI Key ---------------- */

async function validateAssemblyKey(apiKey) {
  let response;
  try {
    response = await fetch(TOKEN_ENDPOINT, { headers: { Authorization: apiKey } });
  } catch (error) {
    return { result: "unverified", message: "网络错误，无法联系 AssemblyAI：" + error.message };
  }
  if (response.ok) return { result: "valid" };
  if (response.status === 401 || response.status === 403) {
    return { result: "invalid", message: "Key 无效（HTTP " + response.status + "）。请检查账号和复制内容。" };
  }
  return { result: "unverified", message: "校验请求异常（HTTP " + response.status + "），暂时无法确认 Key。" };
}

$("save-key").addEventListener("click", async () => {
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

$("clear-key").addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE_KEY);
  keyInput.value = "";
  keyStatus.textContent = "已清除保存的 AssemblyAI Key。";
  showSaved();
});

/* ---------------- 即时保存的字段 ---------------- */

for (const input of document.querySelectorAll('input[name="translate-trigger"]')) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    await chrome.storage.local.set({ [TRIGGER_STORAGE_KEY]: input.value });
    triggerStatus.textContent = input.value === "sentence"
      ? "已保存：每说完一句就翻译（下次开始转写时生效）。"
      : "已保存：等主播停顿后整段翻译（下次开始转写时生效）。";
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
asrModelInput.addEventListener("change", async () => {
  const value = asrModelInput.value.trim() || DEFAULT_ASR_MODEL;
  asrModelInput.value = value;
  await chrome.storage.local.set({ [ASR_MODEL_STORAGE_KEY]: value });
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
videoAsrEnabledInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ [VIDEO_ASR_ENABLED_STORAGE_KEY]: videoAsrEnabledInput.checked });
  showSaved();
});

/* ---------------- 内置翻译模型 ---------------- */

function languagePair() {
  return { sourceLanguage, targetLanguage };
}

function renderModelHeading() {
  modelHeading.textContent = `2. ${sourceLanguageLabel(sourceLanguage)}→${targetLanguageLabel(targetLanguage)}翻译模型（浏览器内置）`;
}

function renderModelStatus(text, { downloadable = false, ready = false } = {}) {
  modelStatus.textContent = text;
  downloadButton.hidden = !downloadable;
  // 橙色提示条是「还有一步要你做」的信号；已就绪时它必须降级成中性卡片。
  modelCallout.className = ready ? "callout ready" : "callout";
  if (!downloadable) {
    downloadProgress.hidden = true;
    downloadButton.disabled = false;
  }
}

function pollUntilAvailabilitySettles() {
  if (availabilityPollTimer) return;
  availabilityPollTimer = setInterval(async () => {
    const availability = await Translator.availability(languagePair());
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
  const availability = await Translator.availability(languagePair());
  switch (availability) {
    case "available":
      renderModelStatus(
        `${sourceLanguageLabel(sourceLanguage)}→${targetLanguageLabel(targetLanguage)}翻译模型已就绪，翻译完全在本地进行。`,
        { ready: true },
      );
      break;
    case "downloadable":
      renderModelStatus("⬇️ 模型支持但未下载。点击右侧按钮开始下载（约需几分钟）。", { downloadable: true });
      break;
    case "downloading":
      renderModelStatus("模型正在下载中，完成后这里会自动更新。");
      downloadProgress.hidden = false;
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
  // popup 也要显示同一条进度，而它无法监听这里的 monitor 事件，所以进度
  // 走一趟 storage（下载结束就把键删掉，避免留下一条永久的 99%）。
  await chrome.storage.local.set({ [TRANSLATOR_PROGRESS_STORAGE_KEY]: 0 });
  try {
    const translator = await Translator.create({
      ...languagePair(),
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = Math.round(event.loaded * 100);
          downloadProgressBar.style.width = `${percent}%`;
          modelStatus.textContent = "模型下载中：" + percent + "%";
          chrome.storage.local.set({ [TRANSLATOR_PROGRESS_STORAGE_KEY]: percent });
        });
      },
    });
    translator.destroy();
    renderModelStatus("翻译模型已下载并就绪。");
  } catch (error) {
    modelStatus.textContent = "下载失败：" + error.name + ": " + error.message;
    downloadButton.disabled = false;
    downloadProgress.hidden = true;
  } finally {
    await chrome.storage.local.remove(TRANSLATOR_PROGRESS_STORAGE_KEY);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // popup 里改语言会落到 storage；设置页的模型标题和可用性判断跟着走。
  if (!changes[SOURCE_LANGUAGE_STORAGE_KEY] && !changes[TARGET_LANGUAGE_STORAGE_KEY]) return;
  if (changes[SOURCE_LANGUAGE_STORAGE_KEY]) {
    sourceLanguage = changes[SOURCE_LANGUAGE_STORAGE_KEY].newValue || DEFAULT_SOURCE_LANGUAGE;
  }
  if (changes[TARGET_LANGUAGE_STORAGE_KEY]) {
    targetLanguage = changes[TARGET_LANGUAGE_STORAGE_KEY].newValue || DEFAULT_TARGET_LANGUAGE;
  }
  renderModelHeading();
  refreshModelStatus();
});

window.addEventListener("unload", () => {
  if (availabilityPollTimer) clearInterval(availabilityPollTimer);
});

loadSettings().then(refreshModelStatus).catch(() => refreshModelStatus());
