import { sessionEndMessages } from "./core/messages.js";
import {
  ACCENT_COLOR_STORAGE_KEY,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_STORAGE_KEY,
} from "./shared/settings.js";

const captureStatusEl = document.getElementById("capture-status");
const transcriptEl = document.getElementById("transcript");
const sessionTimeEl = document.getElementById("session-time");
const startButton = document.getElementById("start-capture");
const stopButton = document.getElementById("stop-capture");
const vuBars = [...document.querySelectorAll(".vu-bar")];
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const panels = [...document.querySelectorAll("[data-panel]")];
const videoCard = document.getElementById("video-card");
const videoCover = document.getElementById("video-cover");
const videoDescription = document.getElementById("video-description");
const videoSource = document.getElementById("video-source");
const videoStatusEl = document.getElementById("video-status");
const videoCaptionsEl = document.getElementById("video-captions");
const videoCountEl = document.getElementById("video-count");
const copyVideoButton = document.getElementById("copy-video");
const workspaceButton = document.getElementById("open-workspace");
const summaryButton = document.getElementById("open-summary");
const rewriteButton = document.getElementById("open-rewrite");
const sourceLanguageInput = document.getElementById("source-language");

let activeBrowserTabId = null;
let videoState = null;

setCapturing(false);
async function syncAccent() {
  const stored = await chrome.storage.local.get({
    [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR,
  });
  document.documentElement.style.setProperty("--accent", stored[ACCENT_COLOR_STORAGE_KEY] || DEFAULT_ACCENT_COLOR);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[ACCENT_COLOR_STORAGE_KEY]) return;
  document.documentElement.style.setProperty("--accent", changes[ACCENT_COLOR_STORAGE_KEY].newValue || DEFAULT_ACCENT_COLOR);
});

startButton.addEventListener("click", () => {
  // 会话启动后源语言固定，先锁住控件，等 background/offscreen 的状态消息
  // 回来再根据成功或失败恢复，避免用户在启动链路中改到另一种语言。
  setCapturing(true);
  chrome.runtime.sendMessage({
    type: "start-capture-request",
    sourceLanguage: sourceLanguageInput.value,
  });
});
stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop-capture-request" });
});
document.getElementById("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

for (const button of tabButtons) {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
}
copyVideoButton.addEventListener("click", copyVideoCaptions);
workspaceButton.addEventListener("click", () => openVideoWorkspace("captions"));
summaryButton.addEventListener("click", () => openVideoWorkspace("summary"));
rewriteButton.addEventListener("click", () => openVideoWorkspace("rewrite"));
sourceLanguageInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ [SOURCE_LANGUAGE_STORAGE_KEY]: sourceLanguageInput.value });
});
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "capture-status":
      setStatus(message.status);
      break;
    case "capture-blocked":
      setStatus(`🚫 ${message.message}`);
      setCapturing(false);
      break;
    case "session-time":
      sessionTimeEl.hidden = false;
      sessionTimeEl.textContent = `⏱ ${formatDuration(message.seconds)}`;
      break;
    case "session-ended":
      setStatus(sessionEndMessages[message.reason] ?? "⏹ 会话已结束。");
      sessionTimeEl.hidden = true;
      setCapturing(false);
      resetVu();
      break;
    case "transcript-update":
      renderTranscript(message);
      break;
    case "video-state-changed":
      if (message.state?.tabId === activeBrowserTabId) renderVideoState(message.state);
      break;
  }
});

function setStatus(status) {
  captureStatusEl.textContent = status;
  updateVu(status);
}

function setCapturing(capturing) {
  startButton.disabled = capturing;
  stopButton.disabled = !capturing;
  sourceLanguageInput.disabled = capturing;
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
    const normalized = Math.max(0.16, Math.min(1, level * 1.6 - index * 0.055));
    bar.style.transform = `scaleY(${normalized})`;
    bar.style.opacity = normalized > 0.2 ? "0.9" : "0.22";
  });
}

function resetVu() {
  vuBars.forEach((bar) => {
    bar.style.transform = "scaleY(.16)";
    bar.style.opacity = "0.22";
  });
}

function renderTranscript({ partial = "", turns = [] }) {
  transcriptEl.replaceChildren();
  if (turns.length === 0 && !partial) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "开始捕获后，已定稿的话轮和进行中的转写会显示在这里。";
    transcriptEl.appendChild(empty);
    return;
  }
  for (const turn of turns.slice(-5)) {
    const source = document.createElement("div");
    source.className = "turn-source";
    source.textContent = turn.source;
    transcriptEl.appendChild(source);
    if (turn.translation) {
      const translation = document.createElement("div");
      translation.className = "turn-translation";
      translation.textContent = turn.translation;
      transcriptEl.appendChild(translation);
    }
  }
  if (partial) {
    const partialEl = document.createElement("div");
    partialEl.className = "turn-partial";
    partialEl.textContent = `${partial} …`;
    transcriptEl.appendChild(partialEl);
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
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
    videoStatusEl.textContent = error.message || "请打开 TikTok 视频页面后重试。";
  }
}

function renderVideoState(state) {
  videoState = state;
  const video = state?.video;
  const captions = state?.captions ?? [];
  const translations = state?.translations ?? [];
  const hasVideo = Boolean(video && !video.pending);
  videoCard.hidden = !hasVideo;
  if (hasVideo) {
    videoCover.src = video.cover || "";
    videoCover.hidden = !video.cover;
    videoDescription.textContent = video.description || "当前视频";
    videoSource.textContent = state.source === "native"
      ? "原生字幕"
      : state.source === "streaming"
        ? "流式转写"
        : state.nativeCaptionsAvailable
          ? "原生字幕可用"
          : "无原生字幕";
  }
  if (!video) {
    videoStatusEl.textContent = "打开 TikTok 视频页面后，这里会显示当前视频的原生字幕。";
  } else if (video.pending) {
    videoStatusEl.textContent = "正在读取当前视频数据…";
  } else if (captions.length) {
    if (state.source === "native") {
      videoStatusEl.textContent = state.translationPending
        ? "已读取 TikTok 原生字幕，正在翻译。"
        : "已读取 TikTok 原生字幕。";
    } else if (state.source === "streaming") {
      const streaming = state.streaming ?? {};
      videoStatusEl.textContent = streaming.status === "inactive"
        ? "视频流式转写已结束。"
        : state.translationPending
          ? "正在流式转写；AI 会在本轮播放结束后整段翻译。"
          : "正在流式转写并更新字幕。";
    } else {
      videoStatusEl.textContent = "已读取视频字幕。";
    }
  } else if (state.nativeCaptionsAvailable) {
    videoStatusEl.textContent = "此视频有原生字幕；可在页面卡片中读取。";
  } else {
    videoStatusEl.textContent = "当前视频没有原生字幕。";
  }
  videoCountEl.textContent = captions.length ? `${captions.length} 条` : "";
  copyVideoButton.disabled = captions.length === 0;
  summaryButton.disabled = captions.length === 0;
  rewriteButton.disabled = captions.length === 0;
  videoCaptionsEl.replaceChildren();
  if (!captions.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "尚未读取字幕。";
    videoCaptionsEl.appendChild(empty);
    return;
  }
  for (let index = 0; index < captions.slice(0, 8).length; index += 1) {
    const caption = captions[index];
    const row = document.createElement("div");
    row.className = "video-caption-row";
    const time = document.createElement("div");
    time.className = "video-time";
    time.textContent = caption.start || "--:--";
    const lines = document.createElement("div");
    const source = document.createElement("div");
    source.textContent = caption.text || "";
    lines.appendChild(source);
    if (translations[index]) {
      const translation = document.createElement("div");
      translation.className = "video-translation";
      translation.textContent = translations[index];
      lines.appendChild(translation);
    }
    row.append(time, lines);
    videoCaptionsEl.appendChild(row);
  }
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
    videoStatusEl.textContent = "字幕已复制。";
  } catch (error) {
    videoStatusEl.textContent = `复制失败：${error.message}`;
  }
}

async function openVideoWorkspace(view) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "open-video-workspace", view });
    if (!result?.ok) throw new Error(result?.error || "无法打开侧边栏。");
  } catch (error) {
    videoStatusEl.textContent = error.message || "请在 TikTok 视频页面打开侧边栏。";
  }
}
// 弹窗重新打开时，立即以 offscreen 的快照恢复会话状态，而不等下一条 tick。
chrome.runtime
  .sendMessage({ target: "offscreen", type: "get-state" })
  .then((state) => {
    if (!state) return;
    const active = state.status === "capturing" || state.status === "idle" || state.status === "reconnecting";
    setCapturing(active);
    if (active && state.sourceLanguage) sourceLanguageInput.value = state.sourceLanguage;
    renderTranscript(state);
    if (active) {
      sessionTimeEl.hidden = false;
      sessionTimeEl.textContent = `⏱ ${formatDuration(state.sessionSeconds ?? 0)}`;
    }
  })
  .catch(() => {
    setCapturing(false);
  });
chrome.tabs.query({ active: true, currentWindow: true })
  .then(([tab]) => {
    activeBrowserTabId = tab?.id ?? null;
    return refreshVideoState();
  })
  .catch(() => renderVideoState(null));
syncAccent().catch(() => {});
chrome.storage.local.get({ [SOURCE_LANGUAGE_STORAGE_KEY]: DEFAULT_SOURCE_LANGUAGE })
  .then((stored) => {
    if (!sourceLanguageInput.disabled) sourceLanguageInput.value = stored[SOURCE_LANGUAGE_STORAGE_KEY];
  })
  .catch(() => {});
