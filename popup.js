import { sessionEndMessages } from "./core/messages.js";
import {
  ACCENT_COLOR_STORAGE_KEY,
  BILINGUAL_STORAGE_KEY,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_BILINGUAL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  SOURCE_LANGUAGES,
  SOURCE_LANGUAGE_STORAGE_KEY,
  TARGET_LANGUAGES,
  TARGET_LANGUAGE_STORAGE_KEY,
  TRANSLATOR_PROGRESS_STORAGE_KEY,
  normalizeAccentColor,
  sourceLanguageLabel,
  targetLanguageLabel,
} from "./shared/settings.js";

const $ = (id) => document.getElementById(id);

const startCard = $("start-capture");
const liveCard = $("live-card");
const liveLabel = $("live-label");
const stopDisc = $("stop-disc");
const stopButton = $("stop-capture");
const liveActions = $("live-actions");
const sessionTimeEl = $("session-time");
const captureStatusEl = $("capture-status");
const captureStatusTextEl = $("capture-status-text");
const transcriptBlock = $("transcript-block");
const transcriptEl = $("transcript");
const transcriptCountEl = $("transcript-count");
const vuBars = [...document.querySelectorAll(".vu-bar")];
const modelBanner = $("model-banner");
const modelBannerText = $("model-banner-text");
const modelDownload = $("model-download");
const modelDownloadPct = $("model-download-pct");
const modelDownloadBar = $("model-download-bar");
const updateNotice = $("update-notice");

const tabButtons = [...document.querySelectorAll("[data-tab]")];
const panels = [...document.querySelectorAll("[data-panel]")];
const sourceLanguageInput = $("source-language");
const targetLanguageInput = $("target-language");
const videoTargetLanguageInput = $("video-target-language");
const liveBilingualInput = $("live-bilingual");
const videoBilingualInput = $("video-bilingual");

const videoCard = $("video-card");
const videoCover = $("video-cover");
const videoDescription = $("video-description");
const videoMeta = $("video-meta");
const videoSourceLanguageEl = $("video-source-language");
const videoStatusEl = $("video-status");
const videoStatusTextEl = $("video-status-text");
const videoRedetectButton = $("video-redetect");
const videoCaptionsEl = $("video-captions");
const videoCountEl = $("video-count");
const copyVideoButton = $("copy-video");
const translateVideoButton = $("translate-video");
const workspaceButton = $("open-workspace");
const summaryButton = $("open-summary");
const rewriteButton = $("open-rewrite");

const TRANSCRIPT_PLACEHOLDER = "开始捕获后，已定稿的话轮和进行中的转写会显示在这里。";
const CAPTION_LANGUAGE_LABELS = {
  en: "英文", es: "西语", ja: "日文", ko: "韩文", fr: "法文", de: "德文", pt: "葡文", zh: "中文",
};

let capturing = false;
let activeBrowserTabId = null;
let videoState = null;
let sourceLanguage = DEFAULT_SOURCE_LANGUAGE;
let targetLanguage = DEFAULT_TARGET_LANGUAGE;
let bilingual = DEFAULT_BILINGUAL;

fillOptions(sourceLanguageInput, SOURCE_LANGUAGES);
fillOptions(targetLanguageInput, TARGET_LANGUAGES);
fillOptions(videoTargetLanguageInput, TARGET_LANGUAGES);
setCapturing(false);
renderTranscript({});
renderVideoState(null);

function fillOptions(select, entries) {
  select.replaceChildren(...entries.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

/* ---------------- 外观 ---------------- */

function applyAccent(color) {
  document.documentElement.style.setProperty("--accent", normalizeAccentColor(color));
}

/* ---------------- 直播实时 ---------------- */

startCard.addEventListener("click", startCapture);
stopDisc.addEventListener("click", stopCapture);
stopButton.addEventListener("click", stopCapture);
$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("model-manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
updateNotice.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "open-options", section: "about" });
  window.close();
});

function startCapture() {
  // 会话启动后源语言固定，先锁住控件，等 background/offscreen 的状态消息
  // 回来再根据成功或失败恢复，避免用户在启动链路中改到另一种语言。
  setCapturing(true);
  setCaptureStatus("");
  chrome.runtime.sendMessage({
    type: "start-capture-request",
    sourceLanguage: sourceLanguageInput.value,
  });
}

function stopCapture() {
  chrome.runtime.sendMessage({ type: "stop-capture-request" });
}

function setCapturing(active) {
  capturing = active;
  startCard.hidden = active;
  liveCard.hidden = !active;
  liveActions.hidden = !active;
  transcriptBlock.hidden = !active;
  sourceLanguageInput.disabled = active;
}

// 捕获态里状态文案就是卡片上那行标题；空闲态它降级成一条灰底提示。
function setStatus(status) {
  if (!status) return;
  if (capturing) {
    liveLabel.textContent = shortStatus(status);
    setCaptureStatus("");
  } else {
    setCaptureStatus(status);
  }
  updateVu(status);
}

function shortStatus(status) {
  const withoutVu = status.replace(/\s*[·|]?\s*音量:.*$/, "").trim();
  return withoutVu || "正在捕获当前标签页音频";
}

function setCaptureStatus(text) {
  captureStatusTextEl.textContent = text;
  captureStatusEl.hidden = !text;
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateVu(status) {
  const match = /音量:.*?(\d+)%/.exec(status);
  if (!match) return;
  const level = Number(match[1]) / 100;
  vuBars.forEach((bar, index) => {
    const normalized = Math.max(0.2, Math.min(1, level * 1.6 - index * 0.045));
    bar.style.transform = `scaleY(${normalized})`;
    bar.style.opacity = normalized > 0.24 ? "0.85" : "0.25";
  });
}

function resetVu() {
  vuBars.forEach((bar) => {
    bar.style.transform = "scaleY(.2)";
    bar.style.opacity = "0.25";
  });
}

function renderTranscript({ partial = "", turns = [] }) {
  transcriptCountEl.textContent = turns.length ? `已定稿 ${turns.length} 句` : "";
  transcriptEl.replaceChildren();
  if (turns.length === 0 && !partial) {
    transcriptEl.append(placeholder(TRANSCRIPT_PLACEHOLDER));
    return;
  }
  for (const turn of turns.slice(-5)) {
    transcriptEl.append(turnRow(turn.source, turn.translation, false));
  }
  if (partial) {
    transcriptEl.append(turnRow(`…${partial}`, "", true));
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function turnRow(source, translation, isPartial) {
  const row = document.createElement("div");
  row.className = isPartial ? "turn partial" : "turn";
  if (bilingual || !translation) {
    const sourceEl = document.createElement("div");
    sourceEl.className = "source";
    sourceEl.textContent = source;
    row.append(sourceEl);
  }
  if (translation) {
    const translationEl = document.createElement("div");
    translationEl.className = "translation";
    translationEl.textContent = translation;
    row.append(translationEl);
  }
  return row;
}

function placeholder(text) {
  const el = document.createElement("div");
  el.className = "placeholder";
  el.textContent = text;
  return el;
}

/* ---------------- 本地翻译模型 ---------------- */

function renderModelBanner(text, { ok = false } = {}) {
  modelBanner.className = ok ? "banner ok" : "banner muted";
  // 绿点只在「已就绪」时出现；没就绪还亮着绿灯比不亮更糟。
  modelBanner.querySelector(".dot").hidden = !ok;
  modelBannerText.textContent = text;
}

function renderDownloadProgress(percent) {
  const active = Number.isFinite(percent) && percent >= 0 && percent < 100;
  modelDownload.hidden = !active;
  if (!active) return;
  modelDownloadPct.textContent = `${Math.round(percent)}%`;
  modelDownloadBar.style.width = `${Math.round(percent)}%`;
}

async function refreshModelBanner() {
  const pair = `${sourceLanguageLabel(sourceLanguage)}→${targetLanguageLabel(targetLanguage)}`;
  if (!("Translator" in self)) {
    renderModelBanner("当前浏览器不支持内置翻译（需要 Chrome 138+）");
    return;
  }
  let availability;
  try {
    availability = await Translator.availability({ sourceLanguage, targetLanguage });
  } catch {
    renderModelBanner(`无法检测本地翻译模型 · ${pair}`);
    return;
  }
  switch (availability) {
    case "available":
      renderModelBanner(`本地翻译模型已就绪 · ${pair}`, { ok: true });
      renderDownloadProgress(NaN);
      break;
    case "downloadable":
      renderModelBanner(`本地翻译模型未下载 · ${pair}`);
      break;
    case "downloading":
      renderModelBanner(`本地翻译模型正在下载 · ${pair}`);
      break;
    default:
      renderModelBanner(`这个语言对在本机不可用 · ${pair}`);
  }
}

/* ---------------- 视频字幕 ---------------- */

for (const button of tabButtons) {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
}
copyVideoButton.addEventListener("click", copyVideoCaptions);
translateVideoButton.addEventListener("click", () => sendVideoCommand("load-captions", "正在获取并翻译字幕…"));
videoRedetectButton.addEventListener("click", () => sendVideoCommand("redetect", "正在重新检测当前视频…"));
workspaceButton.addEventListener("click", () => openVideoWorkspace("captions"));
summaryButton.addEventListener("click", () => openVideoWorkspace("summary"));
rewriteButton.addEventListener("click", () => openVideoWorkspace("rewrite"));

sourceLanguageInput.addEventListener("change", async () => {
  sourceLanguage = sourceLanguageInput.value;
  await chrome.storage.local.set({ [SOURCE_LANGUAGE_STORAGE_KEY]: sourceLanguage });
  refreshModelBanner();
});
for (const select of [targetLanguageInput, videoTargetLanguageInput]) {
  select.addEventListener("change", async () => {
    targetLanguage = select.value;
    targetLanguageInput.value = targetLanguage;
    videoTargetLanguageInput.value = targetLanguage;
    await chrome.storage.local.set({ [TARGET_LANGUAGE_STORAGE_KEY]: targetLanguage });
    refreshModelBanner();
  });
}
for (const input of [liveBilingualInput, videoBilingualInput]) {
  input.addEventListener("change", async () => {
    bilingual = input.checked;
    liveBilingualInput.checked = bilingual;
    videoBilingualInput.checked = bilingual;
    await chrome.storage.local.set({ [BILINGUAL_STORAGE_KEY]: bilingual });
    renderVideoState(videoState);
  });
}

function selectTab(tab) {
  for (const button of tabButtons) {
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== tab;
  if (tab === "video") refreshVideoState();
}

async function refreshVideoState() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "get-active-video-state" });
    if (!result?.ok) throw new Error(result?.error || "无法读取当前视频。");
    renderVideoState(result.data);
  } catch (error) {
    renderVideoState(null);
    setVideoStatus(error.message || "请打开 TikTok 视频页面后重试。");
  }
}

function setVideoStatus(text, { redetect = true } = {}) {
  videoStatusTextEl.textContent = text;
  videoStatusEl.hidden = !text;
  videoRedetectButton.hidden = !redetect;
}

function captionTrackLabel(state) {
  const code = (state?.nativeCaptionLanguage || "").split("-")[0].toLowerCase();
  const label = CAPTION_LANGUAGE_LABELS[code];
  if (state?.source === "streaming") return "流式转写中";
  if (!state?.nativeCaptionsAvailable) return "未检测到字幕轨";
  return label ? `检测到${label}字幕轨` : "检测到原生字幕轨";
}

function renderVideoState(state) {
  videoState = state;
  const video = state?.video;
  const captions = state?.captions ?? [];
  const translations = state?.translations ?? [];
  const hasVideo = Boolean(video && !video.pending);

  videoCard.hidden = !hasVideo;
  if (hasVideo) {
    // 没封面时把 src 整个摘掉，而不是设成空串：空 src 会让 Chrome 画一个
    // 破图标，摘掉之后 44×58 的槽位露出 CSS 里的斜纹底，正是设计稿的占位。
    if (video.cover) videoCover.src = video.cover;
    else videoCover.removeAttribute("src");
    videoDescription.textContent = video.description || "当前视频";
    const duration = Number(video.duration) > 0 ? formatDuration(Math.round(video.duration)) : "--:--";
    videoMeta.textContent = `${duration} · ${captionTrackLabel(state)}`;
  }

  videoSourceLanguageEl.textContent = state?.sourceLanguage
    ? `${sourceLanguageLabel(state.sourceLanguage)}（自动）`
    : "自动";

  if (!video) {
    setVideoStatus("打开 TikTok 视频页面后，这里会显示当前视频的字幕。");
  } else if (video.pending) {
    setVideoStatus("正在读取当前视频数据…");
  } else if (captions.length) {
    setVideoStatus(captionsStatus(state), { redetect: false });
  } else if (state.nativeCaptionsAvailable) {
    setVideoStatus("此视频有原生字幕；点「翻译字幕」读取。", { redetect: false });
  } else {
    setVideoStatus("当前页面未检测到视频字幕轨");
  }

  const translatedCount = translations.filter(Boolean).length;
  videoCountEl.textContent = captions.length ? `${translatedCount} / ${captions.length} 已翻译` : "";
  copyVideoButton.disabled = captions.length === 0;
  summaryButton.disabled = captions.length === 0;
  rewriteButton.disabled = captions.length === 0;
  translateVideoButton.disabled = !hasVideo;

  videoCaptionsEl.replaceChildren();
  if (!captions.length) {
    videoCaptionsEl.append(placeholder("尚未读取字幕。"));
    return;
  }
  for (const [index, caption] of captions.slice(0, 40).entries()) {
    const row = document.createElement("div");
    row.className = "cue";
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = caption.start || "--:--";
    const lines = document.createElement("div");
    lines.className = "lines";
    if (bilingual || !translations[index]) {
      const source = document.createElement("div");
      source.className = "source";
      source.textContent = caption.text || "";
      lines.append(source);
    }
    if (translations[index]) {
      const translation = document.createElement("div");
      translation.className = "translation";
      translation.textContent = translations[index];
      lines.append(translation);
    }
    row.append(time, lines);
    videoCaptionsEl.append(row);
  }
}

function captionsStatus(state) {
  if (state.source === "native") {
    return state.translationPending ? "已读取原生字幕，正在翻译。" : "已读取 TikTok 原生字幕。";
  }
  if (state.source === "streaming") {
    if (state.streaming?.status === "inactive") return "视频流式转写已结束。";
    return state.translationPending
      ? "正在流式转写；AI 会在本轮播放结束后整段翻译。"
      : "正在流式转写并更新字幕。";
  }
  return "已读取视频字幕。";
}

function videoCaptionText() {
  const captions = videoState?.captions ?? [];
  const translations = videoState?.translations ?? [];
  return captions.map((caption, index) => {
    const translation = translations[index] ? `\n${translations[index]}` : "";
    return `${caption.start || "--:--"}-${caption.end || "--:--"}\n${caption.text || ""}${translation}`;
  }).join("\n\n");
}

async function copyVideoCaptions() {
  try {
    await navigator.clipboard.writeText(videoCaptionText());
    setVideoStatus("字幕已复制。", { redetect: false });
  } catch (error) {
    setVideoStatus(`复制失败：${error.message}`, { redetect: false });
  }
}

async function sendVideoCommand(command, pendingText) {
  setVideoStatus(pendingText, { redetect: false });
  try {
    const result = await chrome.runtime.sendMessage({ type: "video-command", command });
    if (!result?.ok) throw new Error(result?.error || "当前页面无法执行该操作。");
  } catch (error) {
    setVideoStatus(error.message || "请在 TikTok 视频页面重试。");
  }
}

async function openVideoWorkspace(view) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "open-video-workspace", view });
    if (!result?.ok) throw new Error(result?.error || "无法打开侧边栏。");
    window.close();
  } catch (error) {
    setVideoStatus(error.message || "请在 TikTok 视频页面打开侧边栏。", { redetect: false });
  }
}

/* ---------------- 消息与初始化 ---------------- */

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "capture-status":
      setStatus(message.status);
      break;
    case "capture-blocked":
      setCapturing(false);
      setCaptureStatus(`🚫 ${message.message}`);
      break;
    case "session-time":
      sessionTimeEl.textContent = formatDuration(message.seconds);
      break;
    case "session-ended":
      setCapturing(false);
      setCaptureStatus(sessionEndMessages[message.reason] ?? "⏹ 会话已结束。");
      sessionTimeEl.textContent = "00:00";
      resetVu();
      break;
    case "transcript-update":
      renderTranscript(message);
      break;
    case "video-state-changed":
      if (message.state?.tabId === activeBrowserTabId) renderVideoState(message.state);
      break;
    case "update-state-changed":
      updateNotice.hidden = !message.view?.availableUpdate;
      break;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[ACCENT_COLOR_STORAGE_KEY]) {
    applyAccent(changes[ACCENT_COLOR_STORAGE_KEY].newValue);
  }
  if (changes[TRANSLATOR_PROGRESS_STORAGE_KEY]) {
    const percent = changes[TRANSLATOR_PROGRESS_STORAGE_KEY].newValue;
    renderDownloadProgress(Number(percent));
    if (percent === undefined) refreshModelBanner();
  }
});

// 弹窗重新打开时，立即以 offscreen 的快照恢复会话状态，而不等下一条 tick。
chrome.runtime
  .sendMessage({ target: "offscreen", type: "get-state" })
  .then((state) => {
    if (!state) return;
    const active = state.status === "capturing" || state.status === "idle" || state.status === "reconnecting";
    setCapturing(active);
    if (active && state.sourceLanguage) {
      sourceLanguage = state.sourceLanguage;
      sourceLanguageInput.value = state.sourceLanguage;
    }
    renderTranscript(state);
    if (active) sessionTimeEl.textContent = formatDuration(state.sessionSeconds ?? 0);
  })
  .catch(() => setCapturing(false));

// popup 只读取 reducer 已有的结论，不在打开时触发新的更新检查。
chrome.runtime.sendMessage({ type: "get-update-view" })
  .then((response) => {
    updateNotice.hidden = !response?.data?.availableUpdate;
  })
  .catch(() => {
    updateNotice.hidden = true;
  });

chrome.tabs.query({ active: true, currentWindow: true })
  .then(([tab]) => {
    activeBrowserTabId = tab?.id ?? null;
    return refreshVideoState();
  })
  .catch(() => renderVideoState(null));

chrome.storage.local.get({
  [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR,
  [SOURCE_LANGUAGE_STORAGE_KEY]: DEFAULT_SOURCE_LANGUAGE,
  [TARGET_LANGUAGE_STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE,
  [BILINGUAL_STORAGE_KEY]: DEFAULT_BILINGUAL,
  [TRANSLATOR_PROGRESS_STORAGE_KEY]: NaN,
})
  .then((stored) => {
    applyAccent(stored[ACCENT_COLOR_STORAGE_KEY]);
    sourceLanguage = stored[SOURCE_LANGUAGE_STORAGE_KEY];
    targetLanguage = stored[TARGET_LANGUAGE_STORAGE_KEY];
    bilingual = stored[BILINGUAL_STORAGE_KEY];
    if (!sourceLanguageInput.disabled) sourceLanguageInput.value = sourceLanguage;
    targetLanguageInput.value = targetLanguage;
    videoTargetLanguageInput.value = targetLanguage;
    liveBilingualInput.checked = bilingual;
    videoBilingualInput.checked = bilingual;
    renderDownloadProgress(Number(stored[TRANSLATOR_PROGRESS_STORAGE_KEY]));
    return refreshModelBanner();
  })
  .catch(() => refreshModelBanner());
