(() => {
  // core/messages.js
  var sessionEndMessages = {
    "session-cap": "\u23F0 \u5DF2\u8FBE\u5355\u6B21\u4F1A\u8BDD\u4E0A\u9650\uFF081 \u5C0F\u65F6\uFF09\uFF0C\u8FDE\u63A5\u5DF2\u7ED3\u675F\u3002\u60F3\u7EE7\u7EED\u770B\u8BF7\u518D\u70B9\u4E00\u6B21\u300C\u5F00\u59CB\u300D\u3002",
    "audio-ended": "\u{1F4E1} \u97F3\u9891\u5DF2\u7ED3\u675F\uFF08\u6807\u7B7E\u9875\u5173\u95ED\u6216\u76F4\u64AD\u65AD\u6D41\uFF09\uFF0C\u6355\u83B7\u5DF2\u81EA\u52A8\u505C\u6B62\u3002",
    "auth-error": "\u{1F511} \u8F6C\u5199\u670D\u52A1\u62D2\u7EDD\u4E86\u8BF7\u6C42\uFF1AKey \u65E0\u6548\u3001\u4F59\u989D\u8017\u5C3D\u6216\u4F1A\u8BDD\u5230\u9650\u3002\u8BF7\u5230\u8BBE\u7F6E\u9875\u68C0\u67E5 Key \u4E0E\u8D26\u6237\u4F59\u989D\u3002",
    "reconnect-exhausted": "\u{1F310} \u591A\u6B21\u91CD\u8FDE\u4ECD\u5931\u8D25\uFF0C\u5DF2\u505C\u6B62\uFF08\u4E0D\u518D\u81EA\u52A8\u91CD\u8BD5\uFF09\u3002\u7F51\u7EDC\u6062\u590D\u540E\u53EF\u91CD\u65B0\u70B9\u300C\u5F00\u59CB\u300D\u3002",
    "capture-failed": "\u274C \u6355\u83B7\u5931\u8D25\uFF0C\u4F1A\u8BDD\u5DF2\u7ED3\u675F\u3002",
    "user-stop": "\u23F9 \u5DF2\u505C\u6B62\u6355\u83B7\u3002",
    "video-playthrough": "\u25B6\uFE0F \u89C6\u9891\u5DF2\u64AD\u653E\u5B8C\u4E00\u8F6E\uFF0C\u8F6C\u5199\u5DF2\u81EA\u52A8\u505C\u6B62\u3002"
  };

  // shared/settings.js
  var CHAT_BASE_URL_STORAGE_KEY = "chatBaseUrl";
  var CHAT_API_KEY_STORAGE_KEY = "chatApiKey";
  var CHAT_MODEL_STORAGE_KEY = "chatModel";
  var ASR_MODEL_STORAGE_KEY = "asrModel";
  var DEFAULT_ASR_MODEL = "universal";
  var CHAT_DEFAULTS = {
    [CHAT_BASE_URL_STORAGE_KEY]: "",
    [CHAT_API_KEY_STORAGE_KEY]: "",
    [CHAT_MODEL_STORAGE_KEY]: "gpt-4o-mini",
    [ASR_MODEL_STORAGE_KEY]: DEFAULT_ASR_MODEL
  };
  var ACCENT_COLOR_STORAGE_KEY = "accentColor";
  var DEFAULT_ACCENT_COLOR = "oklch(0.58 0.14 195)";
  var LEGACY_ACCENT_COLORS = {
    "#168ea3": "oklch(0.58 0.14 195)",
    "#5d55c7": "oklch(0.55 0.16 285)",
    "#238b5d": "oklch(0.6 0.16 150)",
    "#c65b3f": "oklch(0.6 0.17 25)"
  };
  function normalizeAccentColor(value) {
    if (!value) return DEFAULT_ACCENT_COLOR;
    return LEGACY_ACCENT_COLORS[value.toLowerCase()] ?? value;
  }
  var SOURCE_LANGUAGE_STORAGE_KEY = "sourceLanguage";
  var DEFAULT_SOURCE_LANGUAGE = "es";
  var TARGET_LANGUAGE_STORAGE_KEY = "targetLanguage";
  var DEFAULT_TARGET_LANGUAGE = "zh";
  var BILINGUAL_STORAGE_KEY = "bilingual";
  var DEFAULT_BILINGUAL = true;
  var SOURCE_LANGUAGES = [
    { value: "es", label: "\u897F\u73ED\u7259\u8BED" },
    { value: "en", label: "\u82F1\u8BED" },
    { value: "ja", label: "\u65E5\u8BED" },
    { value: "ko", label: "\u97E9\u8BED" },
    { value: "fr", label: "\u6CD5\u8BED" },
    { value: "de", label: "\u5FB7\u8BED" },
    { value: "pt", label: "\u8461\u8404\u7259\u8BED" }
  ];
  var TARGET_LANGUAGES = [
    { value: "zh", label: "\u7B80\u4F53\u4E2D\u6587" },
    { value: "zh-Hant", label: "\u7E41\u4F53\u4E2D\u6587" },
    { value: "en", label: "\u82F1\u8BED" },
    { value: "ja", label: "\u65E5\u8BED" }
  ];
  function sourceLanguageLabel(value) {
    return SOURCE_LANGUAGES.find((language) => language.value === value)?.label ?? value;
  }
  function targetLanguageLabel(value) {
    return TARGET_LANGUAGES.find((language) => language.value === value)?.label ?? value;
  }
  var TRANSLATOR_PROGRESS_STORAGE_KEY = "translatorDownloadProgress";

  // popup.js
  var $ = (id) => document.getElementById(id);
  var startCard = $("start-capture");
  var liveCard = $("live-card");
  var liveLabel = $("live-label");
  var stopDisc = $("stop-disc");
  var stopButton = $("stop-capture");
  var liveActions = $("live-actions");
  var sessionTimeEl = $("session-time");
  var captureStatusEl = $("capture-status");
  var captureStatusTextEl = $("capture-status-text");
  var transcriptBlock = $("transcript-block");
  var transcriptEl = $("transcript");
  var transcriptCountEl = $("transcript-count");
  var vuBars = [...document.querySelectorAll(".vu-bar")];
  var modelBanner = $("model-banner");
  var modelBannerText = $("model-banner-text");
  var modelDownload = $("model-download");
  var modelDownloadPct = $("model-download-pct");
  var modelDownloadBar = $("model-download-bar");
  var updateNotice = $("update-notice");
  var tabButtons = [...document.querySelectorAll("[data-tab]")];
  var panels = [...document.querySelectorAll("[data-panel]")];
  var sourceLanguageInput = $("source-language");
  var targetLanguageInput = $("target-language");
  var videoTargetLanguageInput = $("video-target-language");
  var liveBilingualInput = $("live-bilingual");
  var videoBilingualInput = $("video-bilingual");
  var videoCard = $("video-card");
  var videoCover = $("video-cover");
  var videoDescription = $("video-description");
  var videoMeta = $("video-meta");
  var videoSourceLanguageEl = $("video-source-language");
  var videoStatusEl = $("video-status");
  var videoStatusTextEl = $("video-status-text");
  var videoRedetectButton = $("video-redetect");
  var videoCaptionsEl = $("video-captions");
  var videoCountEl = $("video-count");
  var copyVideoButton = $("copy-video");
  var translateVideoButton = $("translate-video");
  var workspaceButton = $("open-workspace");
  var summaryButton = $("open-summary");
  var rewriteButton = $("open-rewrite");
  var TRANSCRIPT_PLACEHOLDER = "\u5F00\u59CB\u6355\u83B7\u540E\uFF0C\u5DF2\u5B9A\u7A3F\u7684\u8BDD\u8F6E\u548C\u8FDB\u884C\u4E2D\u7684\u8F6C\u5199\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002";
  var CAPTION_LANGUAGE_LABELS = {
    en: "\u82F1\u6587",
    es: "\u897F\u8BED",
    ja: "\u65E5\u6587",
    ko: "\u97E9\u6587",
    fr: "\u6CD5\u6587",
    de: "\u5FB7\u6587",
    pt: "\u8461\u6587",
    zh: "\u4E2D\u6587"
  };
  var capturing = false;
  var activeBrowserTabId = null;
  var videoState = null;
  var sourceLanguage = DEFAULT_SOURCE_LANGUAGE;
  var targetLanguage = DEFAULT_TARGET_LANGUAGE;
  var bilingual = DEFAULT_BILINGUAL;
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
  function applyAccent(color) {
    document.documentElement.style.setProperty("--accent", normalizeAccentColor(color));
  }
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
    setCapturing(true);
    setCaptureStatus("");
    chrome.runtime.sendMessage({
      type: "start-capture-request",
      sourceLanguage: sourceLanguageInput.value
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
    return withoutVu || "\u6B63\u5728\u6355\u83B7\u5F53\u524D\u6807\u7B7E\u9875\u97F3\u9891";
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
    transcriptCountEl.textContent = turns.length ? `\u5DF2\u5B9A\u7A3F ${turns.length} \u53E5` : "";
    transcriptEl.replaceChildren();
    if (turns.length === 0 && !partial) {
      transcriptEl.append(placeholder(TRANSCRIPT_PLACEHOLDER));
      return;
    }
    for (const turn of turns.slice(-5)) {
      transcriptEl.append(turnRow(turn.source, turn.translation, false));
    }
    if (partial) {
      transcriptEl.append(turnRow(`\u2026${partial}`, "", true));
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
  function renderModelBanner(text, { ok = false } = {}) {
    modelBanner.className = ok ? "banner ok" : "banner muted";
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
    const pair = `${sourceLanguageLabel(sourceLanguage)}\u2192${targetLanguageLabel(targetLanguage)}`;
    if (!("Translator" in self)) {
      renderModelBanner("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5185\u7F6E\u7FFB\u8BD1\uFF08\u9700\u8981 Chrome 138+\uFF09");
      return;
    }
    let availability;
    try {
      availability = await Translator.availability({ sourceLanguage, targetLanguage });
    } catch {
      renderModelBanner(`\u65E0\u6CD5\u68C0\u6D4B\u672C\u5730\u7FFB\u8BD1\u6A21\u578B \xB7 ${pair}`);
      return;
    }
    switch (availability) {
      case "available":
        renderModelBanner(`\u672C\u5730\u7FFB\u8BD1\u6A21\u578B\u5DF2\u5C31\u7EEA \xB7 ${pair}`, { ok: true });
        renderDownloadProgress(NaN);
        break;
      case "downloadable":
        renderModelBanner(`\u672C\u5730\u7FFB\u8BD1\u6A21\u578B\u672A\u4E0B\u8F7D \xB7 ${pair}`);
        break;
      case "downloading":
        renderModelBanner(`\u672C\u5730\u7FFB\u8BD1\u6A21\u578B\u6B63\u5728\u4E0B\u8F7D \xB7 ${pair}`);
        break;
      default:
        renderModelBanner(`\u8FD9\u4E2A\u8BED\u8A00\u5BF9\u5728\u672C\u673A\u4E0D\u53EF\u7528 \xB7 ${pair}`);
    }
  }
  for (const button of tabButtons) {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  }
  copyVideoButton.addEventListener("click", copyVideoCaptions);
  translateVideoButton.addEventListener("click", () => sendVideoCommand("load-captions", "\u6B63\u5728\u83B7\u53D6\u5E76\u7FFB\u8BD1\u5B57\u5E55\u2026"));
  videoRedetectButton.addEventListener("click", () => sendVideoCommand("redetect", "\u6B63\u5728\u91CD\u65B0\u68C0\u6D4B\u5F53\u524D\u89C6\u9891\u2026"));
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
      if (!result?.ok) throw new Error(result?.error || "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u89C6\u9891\u3002");
      renderVideoState(result.data);
    } catch (error) {
      renderVideoState(null);
      setVideoStatus(error.message || "\u8BF7\u6253\u5F00 TikTok \u89C6\u9891\u9875\u9762\u540E\u91CD\u8BD5\u3002");
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
    if (state?.source === "streaming") return "\u6D41\u5F0F\u8F6C\u5199\u4E2D";
    if (!state?.nativeCaptionsAvailable) return "\u672A\u68C0\u6D4B\u5230\u5B57\u5E55\u8F68";
    return label ? `\u68C0\u6D4B\u5230${label}\u5B57\u5E55\u8F68` : "\u68C0\u6D4B\u5230\u539F\u751F\u5B57\u5E55\u8F68";
  }
  function renderVideoState(state) {
    videoState = state;
    const video = state?.video;
    const captions = state?.captions ?? [];
    const translations = state?.translations ?? [];
    const hasVideo = Boolean(video && !video.pending);
    videoCard.hidden = !hasVideo;
    if (hasVideo) {
      if (video.cover) videoCover.src = video.cover;
      else videoCover.removeAttribute("src");
      videoDescription.textContent = video.description || "\u5F53\u524D\u89C6\u9891";
      const duration = Number(video.duration) > 0 ? formatDuration(Math.round(video.duration)) : "--:--";
      videoMeta.textContent = `${duration} \xB7 ${captionTrackLabel(state)}`;
    }
    videoSourceLanguageEl.textContent = state?.sourceLanguage ? `${sourceLanguageLabel(state.sourceLanguage)}\uFF08\u81EA\u52A8\uFF09` : "\u81EA\u52A8";
    if (!video) {
      setVideoStatus("\u6253\u5F00 TikTok \u89C6\u9891\u9875\u9762\u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u5F53\u524D\u89C6\u9891\u7684\u5B57\u5E55\u3002");
    } else if (video.pending) {
      setVideoStatus("\u6B63\u5728\u8BFB\u53D6\u5F53\u524D\u89C6\u9891\u6570\u636E\u2026");
    } else if (captions.length) {
      setVideoStatus(captionsStatus(state), { redetect: false });
    } else if (state.nativeCaptionsAvailable) {
      setVideoStatus("\u6B64\u89C6\u9891\u6709\u539F\u751F\u5B57\u5E55\uFF1B\u70B9\u300C\u7FFB\u8BD1\u5B57\u5E55\u300D\u8BFB\u53D6\u3002", { redetect: false });
    } else {
      setVideoStatus("\u5F53\u524D\u9875\u9762\u672A\u68C0\u6D4B\u5230\u89C6\u9891\u5B57\u5E55\u8F68");
    }
    const translatedCount = translations.filter(Boolean).length;
    videoCountEl.textContent = captions.length ? `${translatedCount} / ${captions.length} \u5DF2\u7FFB\u8BD1` : "";
    copyVideoButton.disabled = captions.length === 0;
    summaryButton.disabled = captions.length === 0;
    rewriteButton.disabled = captions.length === 0;
    translateVideoButton.disabled = !hasVideo;
    videoCaptionsEl.replaceChildren();
    if (!captions.length) {
      videoCaptionsEl.append(placeholder("\u5C1A\u672A\u8BFB\u53D6\u5B57\u5E55\u3002"));
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
      return state.translationPending ? "\u5DF2\u8BFB\u53D6\u539F\u751F\u5B57\u5E55\uFF0C\u6B63\u5728\u7FFB\u8BD1\u3002" : "\u5DF2\u8BFB\u53D6 TikTok \u539F\u751F\u5B57\u5E55\u3002";
    }
    if (state.source === "streaming") {
      if (state.streaming?.status === "inactive") return "\u89C6\u9891\u6D41\u5F0F\u8F6C\u5199\u5DF2\u7ED3\u675F\u3002";
      return state.translationPending ? "\u6B63\u5728\u6D41\u5F0F\u8F6C\u5199\uFF1BAI \u4F1A\u5728\u672C\u8F6E\u64AD\u653E\u7ED3\u675F\u540E\u6574\u6BB5\u7FFB\u8BD1\u3002" : "\u6B63\u5728\u6D41\u5F0F\u8F6C\u5199\u5E76\u66F4\u65B0\u5B57\u5E55\u3002";
    }
    return "\u5DF2\u8BFB\u53D6\u89C6\u9891\u5B57\u5E55\u3002";
  }
  function videoCaptionText() {
    const captions = videoState?.captions ?? [];
    const translations = videoState?.translations ?? [];
    return captions.map((caption, index) => {
      const translation = translations[index] ? `
${translations[index]}` : "";
      return `${caption.start || "--:--"}-${caption.end || "--:--"}
${caption.text || ""}${translation}`;
    }).join("\n\n");
  }
  async function copyVideoCaptions() {
    try {
      await navigator.clipboard.writeText(videoCaptionText());
      setVideoStatus("\u5B57\u5E55\u5DF2\u590D\u5236\u3002", { redetect: false });
    } catch (error) {
      setVideoStatus(`\u590D\u5236\u5931\u8D25\uFF1A${error.message}`, { redetect: false });
    }
  }
  async function sendVideoCommand(command, pendingText) {
    setVideoStatus(pendingText, { redetect: false });
    try {
      const result = await chrome.runtime.sendMessage({ type: "video-command", command });
      if (!result?.ok) throw new Error(result?.error || "\u5F53\u524D\u9875\u9762\u65E0\u6CD5\u6267\u884C\u8BE5\u64CD\u4F5C\u3002");
    } catch (error) {
      setVideoStatus(error.message || "\u8BF7\u5728 TikTok \u89C6\u9891\u9875\u9762\u91CD\u8BD5\u3002");
    }
  }
  async function openVideoWorkspace(view) {
    try {
      const result = await chrome.runtime.sendMessage({ type: "open-video-workspace", view });
      if (!result?.ok) throw new Error(result?.error || "\u65E0\u6CD5\u6253\u5F00\u4FA7\u8FB9\u680F\u3002");
      window.close();
    } catch (error) {
      setVideoStatus(error.message || "\u8BF7\u5728 TikTok \u89C6\u9891\u9875\u9762\u6253\u5F00\u4FA7\u8FB9\u680F\u3002", { redetect: false });
    }
  }
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case "capture-status":
        setStatus(message.status);
        break;
      case "capture-blocked":
        setCapturing(false);
        setCaptureStatus(`\u{1F6AB} ${message.message}`);
        break;
      case "session-time":
        sessionTimeEl.textContent = formatDuration(message.seconds);
        break;
      case "session-ended":
        setCapturing(false);
        setCaptureStatus(sessionEndMessages[message.reason] ?? "\u23F9 \u4F1A\u8BDD\u5DF2\u7ED3\u675F\u3002");
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
      if (percent === void 0) refreshModelBanner();
    }
  });
  chrome.runtime.sendMessage({ target: "offscreen", type: "get-state" }).then((state) => {
    if (!state) return;
    const active = state.status === "capturing" || state.status === "idle" || state.status === "reconnecting";
    setCapturing(active);
    if (active && state.sourceLanguage) {
      sourceLanguage = state.sourceLanguage;
      sourceLanguageInput.value = state.sourceLanguage;
    }
    renderTranscript(state);
    if (active) sessionTimeEl.textContent = formatDuration(state.sessionSeconds ?? 0);
  }).catch(() => setCapturing(false));
  chrome.runtime.sendMessage({ type: "get-update-view" }).then((response) => {
    updateNotice.hidden = !response?.data?.availableUpdate;
  }).catch(() => {
    updateNotice.hidden = true;
  });
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    activeBrowserTabId = tab?.id ?? null;
    return refreshVideoState();
  }).catch(() => renderVideoState(null));
  chrome.storage.local.get({
    [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR,
    [SOURCE_LANGUAGE_STORAGE_KEY]: DEFAULT_SOURCE_LANGUAGE,
    [TARGET_LANGUAGE_STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE,
    [BILINGUAL_STORAGE_KEY]: DEFAULT_BILINGUAL,
    [TRANSLATOR_PROGRESS_STORAGE_KEY]: NaN
  }).then((stored) => {
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
  }).catch(() => refreshModelBanner());
})();
