(() => {
  // shared/settings.js
  var STORAGE_KEY = "assemblyaiApiKey";
  var TRIGGER_STORAGE_KEY = "translateTrigger";
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
  var AUTO_CAPTION_MODE_STORAGE_KEY = "autoCaptionMode";
  var ACCENT_COLOR_STORAGE_KEY = "accentColor";
  var VIDEO_ASR_ENABLED_STORAGE_KEY = "videoAsrEnabled";
  var DEFAULT_VIDEO_ASR_ENABLED = false;
  var DEFAULT_ACCENT_COLOR = "oklch(0.58 0.14 195)";
  var ACCENT_COLORS = [
    { value: "oklch(0.58 0.14 195)", label: "\u9752\u84DD\uFF08\u9ED8\u8BA4\uFF09" },
    { value: "oklch(0.55 0.16 285)", label: "\u975B\u7D2B" },
    { value: "oklch(0.6 0.16 150)", label: "\u7FE0\u7EFF" },
    { value: "oklch(0.6 0.17 25)", label: "\u6731\u7EA2" }
  ];
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
  var VIDEO_TRANSLATION_ENGINE_STORAGE_KEY = "videoTranslationEngine";
  var DEFAULT_VIDEO_TRANSLATION_ENGINE = "builtin";
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

  // options.js
  var TOKEN_ENDPOINT = "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60";
  var $ = (id) => document.getElementById(id);
  var keyInput = $("api-key");
  var keyStatus = $("key-status");
  var modelHeading = $("model-heading");
  var modelCallout = $("model-callout");
  var modelStatus = $("model-status");
  var downloadButton = $("download-model");
  var downloadProgress = $("download-progress");
  var downloadProgressBar = $("download-progress-bar");
  var triggerStatus = $("trigger-status");
  var saveIndicator = $("save-indicator");
  var chatBaseUrlInput = $("chat-base-url");
  var chatApiKeyInput = $("chat-api-key");
  var chatModelInput = $("chat-model");
  var asrModelInput = $("asr-model");
  var autoCaptionModeInput = $("auto-caption-mode");
  var videoTranslationEngineInput = $("video-translation-engine");
  var videoAsrEnabledInput = $("video-asr-enabled");
  var accentSwatches = $("accent-swatches");
  var checkUpdateButton = $("check-update");
  var runningVersionEl = $("running-version");
  var releasedVersionRow = $("released-version-row");
  var releasedVersionEl = $("released-version");
  var updateMessageEl = $("update-message");
  var updateStepsEl = $("update-steps");
  var reloadExtensionButton = $("reload-extension");
  var reloadReasonEl = $("reload-reason");
  var sourceLanguage = DEFAULT_SOURCE_LANGUAGE;
  var targetLanguage = DEFAULT_TARGET_LANGUAGE;
  var availabilityPollTimer = null;
  var saveIndicatorTimer = null;
  $("about-version").textContent = `v${chrome.runtime.getManifest().version} \xB7 EchoSage`;
  renderAccentSwatches();
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
  var requestedSection = location.hash.slice(1);
  if (["live", "video", "overlay", "about"].includes(requestedSection)) {
    selectSection(requestedSection);
  }
  function renderUpdateView(view) {
    if (!view) return;
    runningVersionEl.textContent = view.runningVersion ? `v${view.runningVersion}` : "\u2014";
    releasedVersionRow.hidden = !view.releasedVersion;
    if (view.releasedVersion) {
      releasedVersionEl.textContent = view.releasedVersion;
      if (view.releaseUrl) releasedVersionEl.href = view.releaseUrl;
      else releasedVersionEl.removeAttribute("href");
    }
    checkUpdateButton.textContent = view.checkButton.label;
    checkUpdateButton.disabled = view.checkButton.disabled;
    updateMessageEl.hidden = !view.message;
    updateMessageEl.textContent = view.message ?? "";
    updateMessageEl.dataset.tone = view.messageTone ?? "";
    updateStepsEl.hidden = !view.updateInstructions;
    if (view.updateInstructions) {
      $("update-pull-step").textContent = view.updateInstructions.pull;
      $("update-reload-step").textContent = view.updateInstructions.reload;
      $("update-badge-note").textContent = view.updateInstructions.badge;
    }
    reloadExtensionButton.textContent = view.reloadButton.label;
    reloadExtensionButton.disabled = view.reloadButton.disabled;
    reloadReasonEl.textContent = view.reloadButton.reason;
  }
  checkUpdateButton.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "user-requested-update-check" });
    if (response?.data) renderUpdateView(response.data);
  });
  reloadExtensionButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "user-requested-extension-reload" });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "update-state-changed") renderUpdateView(message.view);
  });
  chrome.runtime.sendMessage({ type: "get-update-view" }).then((response) => renderUpdateView(response?.data)).catch(() => {
  });
  function showSaved(message = "\u5DF2\u4FDD\u5B58") {
    saveIndicator.textContent = message;
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => {
      saveIndicator.textContent = "\u4FEE\u6539\u5373\u65F6\u4FDD\u5B58";
    }, 1800);
  }
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
  async function loadSettings() {
    const stored = await chrome.storage.local.get({
      [TRIGGER_STORAGE_KEY]: "pause",
      [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR,
      [AUTO_CAPTION_MODE_STORAGE_KEY]: "manual",
      [SOURCE_LANGUAGE_STORAGE_KEY]: DEFAULT_SOURCE_LANGUAGE,
      [TARGET_LANGUAGE_STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE,
      [VIDEO_TRANSLATION_ENGINE_STORAGE_KEY]: DEFAULT_VIDEO_TRANSLATION_ENGINE,
      [VIDEO_ASR_ENABLED_STORAGE_KEY]: DEFAULT_VIDEO_ASR_ENABLED,
      ...CHAT_DEFAULTS
    });
    sourceLanguage = stored[SOURCE_LANGUAGE_STORAGE_KEY] || DEFAULT_SOURCE_LANGUAGE;
    targetLanguage = stored[TARGET_LANGUAGE_STORAGE_KEY] || DEFAULT_TARGET_LANGUAGE;
    renderModelHeading();
    const trigger = stored[TRIGGER_STORAGE_KEY];
    for (const input of document.querySelectorAll('input[name="translate-trigger"]')) {
      input.checked = input.value === trigger;
    }
    triggerStatus.textContent = trigger === "sentence" ? "\u5F53\u524D\uFF1A\u6BCF\u8BF4\u5B8C\u4E00\u53E5\u5C31\u7FFB\u8BD1\u3002" : "\u5F53\u524D\uFF1A\u7B49\u4E3B\u64AD\u505C\u987F\u540E\u6574\u6BB5\u7FFB\u8BD1\uFF08\u9ED8\u8BA4\uFF09\u3002";
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
    keyStatus.textContent = keyData[STORAGE_KEY] ? "\u5DF2\u4FDD\u5B58\u4E00\u4E2A AssemblyAI Key\u3002\u91CD\u65B0\u4FDD\u5B58\u53EF\u8986\u76D6\u3002" : "\u5C1A\u672A\u4FDD\u5B58 Key\u3002\u586B\u5165\u540E\u70B9\u300C\u4FDD\u5B58\u5E76\u6821\u9A8C\u300D\u3002";
    chatApiKeyInput.placeholder = keyData[CHAT_API_KEY_STORAGE_KEY] ? "\u5DF2\u4FDD\u5B58\u4E00\u4E2A API Key\uFF1B\u586B\u5165\u65B0\u503C\u53EF\u8986\u76D6" : "sk-\u2026";
  }
  async function validateAssemblyKey(apiKey) {
    let response;
    try {
      response = await fetch(TOKEN_ENDPOINT, { headers: { Authorization: apiKey } });
    } catch (error) {
      return { result: "unverified", message: "\u7F51\u7EDC\u9519\u8BEF\uFF0C\u65E0\u6CD5\u8054\u7CFB AssemblyAI\uFF1A" + error.message };
    }
    if (response.ok) return { result: "valid" };
    if (response.status === 401 || response.status === 403) {
      return { result: "invalid", message: "Key \u65E0\u6548\uFF08HTTP " + response.status + "\uFF09\u3002\u8BF7\u68C0\u67E5\u8D26\u53F7\u548C\u590D\u5236\u5185\u5BB9\u3002" };
    }
    return { result: "unverified", message: "\u6821\u9A8C\u8BF7\u6C42\u5F02\u5E38\uFF08HTTP " + response.status + "\uFF09\uFF0C\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4 Key\u3002" };
  }
  $("save-key").addEventListener("click", async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      keyStatus.textContent = "\u8BF7\u5148\u586B\u5165 AssemblyAI API Key\u3002";
      return;
    }
    keyStatus.textContent = "\u6821\u9A8C\u4E2D\uFF08\u5C1D\u8BD5\u6362\u53D6\u4E34\u65F6 token\uFF09\u2026";
    const outcome = await validateAssemblyKey(apiKey);
    if (outcome.result === "invalid") {
      keyStatus.textContent = "\u672A\u4FDD\u5B58\uFF1A" + outcome.message;
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: apiKey });
    keyInput.value = "";
    keyStatus.textContent = outcome.result === "valid" ? "Key \u6709\u6548\uFF0C\u5DF2\u4FDD\u5B58\u3002" : "\u5DF2\u4FDD\u5B58\uFF0C\u4F46" + outcome.message;
    showSaved();
  });
  $("clear-key").addEventListener("click", async () => {
    await chrome.storage.local.remove(STORAGE_KEY);
    keyInput.value = "";
    keyStatus.textContent = "\u5DF2\u6E05\u9664\u4FDD\u5B58\u7684 AssemblyAI Key\u3002";
    showSaved();
  });
  for (const input of document.querySelectorAll('input[name="translate-trigger"]')) {
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      await chrome.storage.local.set({ [TRIGGER_STORAGE_KEY]: input.value });
      triggerStatus.textContent = input.value === "sentence" ? "\u5DF2\u4FDD\u5B58\uFF1A\u6BCF\u8BF4\u5B8C\u4E00\u53E5\u5C31\u7FFB\u8BD1\uFF08\u4E0B\u6B21\u5F00\u59CB\u8F6C\u5199\u65F6\u751F\u6548\uFF09\u3002" : "\u5DF2\u4FDD\u5B58\uFF1A\u7B49\u4E3B\u64AD\u505C\u987F\u540E\u6574\u6BB5\u7FFB\u8BD1\uFF08\u4E0B\u6B21\u5F00\u59CB\u8F6C\u5199\u65F6\u751F\u6548\uFF09\u3002";
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
    chatApiKeyInput.placeholder = "\u5DF2\u4FDD\u5B58\u4E00\u4E2A API Key\uFF1B\u586B\u5165\u65B0\u503C\u53EF\u8986\u76D6";
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
  function languagePair() {
    return { sourceLanguage, targetLanguage };
  }
  function renderModelHeading() {
    modelHeading.textContent = `2. ${sourceLanguageLabel(sourceLanguage)}\u2192${targetLanguageLabel(targetLanguage)}\u7FFB\u8BD1\u6A21\u578B\uFF08\u6D4F\u89C8\u5668\u5185\u7F6E\uFF09`;
  }
  function renderModelStatus(text, { downloadable = false, ready = false } = {}) {
    modelStatus.textContent = text;
    downloadButton.hidden = !downloadable;
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
    }, 3e3);
  }
  async function refreshModelStatus() {
    if (!("Translator" in self)) {
      renderModelStatus(
        "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5185\u7F6E\u7FFB\u8BD1\uFF08\u6CA1\u6709 Translator API\uFF09\u3002EchoSage \u6CA1\u6709\u76F4\u64AD\u5B9E\u65F6\u7684\u4E91\u7AEF\u7FFB\u8BD1\u515C\u5E95\uFF1B\u53EF\u7528\u6D4F\u89C8\u5668\uFF1AChrome 138+ / Edge 148+\u3002"
      );
      return;
    }
    const availability = await Translator.availability(languagePair());
    switch (availability) {
      case "available":
        renderModelStatus(
          `${sourceLanguageLabel(sourceLanguage)}\u2192${targetLanguageLabel(targetLanguage)}\u7FFB\u8BD1\u6A21\u578B\u5DF2\u5C31\u7EEA\uFF0C\u7FFB\u8BD1\u5B8C\u5168\u5728\u672C\u5730\u8FDB\u884C\u3002`,
          { ready: true }
        );
        break;
      case "downloadable":
        renderModelStatus("\u2B07\uFE0F \u6A21\u578B\u652F\u6301\u4F46\u672A\u4E0B\u8F7D\u3002\u70B9\u51FB\u53F3\u4FA7\u6309\u94AE\u5F00\u59CB\u4E0B\u8F7D\uFF08\u7EA6\u9700\u51E0\u5206\u949F\uFF09\u3002", { downloadable: true });
        break;
      case "downloading":
        renderModelStatus("\u6A21\u578B\u6B63\u5728\u4E0B\u8F7D\u4E2D\uFF0C\u5B8C\u6210\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u66F4\u65B0\u3002");
        downloadProgress.hidden = false;
        pollUntilAvailabilitySettles();
        break;
      default:
        renderModelStatus("\u5F53\u524D\u8BBE\u5907\u6216\u8FD9\u4E2A\u8BED\u8A00\u5BF9\u4E0D\u53EF\u7528\u3002\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u7248\u672C\u3001\u78C1\u76D8\u7A7A\u95F4\u548C\u672C\u5730\u6A21\u578B\u652F\u6301\u60C5\u51B5\u3002");
    }
  }
  downloadButton.addEventListener("click", async () => {
    downloadButton.disabled = true;
    downloadProgress.hidden = false;
    modelStatus.textContent = "\u4E0B\u8F7D\u4E2D\u2026";
    await chrome.storage.local.set({ [TRANSLATOR_PROGRESS_STORAGE_KEY]: 0 });
    try {
      const translator = await Translator.create({
        ...languagePair(),
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const percent = Math.round(event.loaded * 100);
            downloadProgressBar.style.width = `${percent}%`;
            modelStatus.textContent = "\u6A21\u578B\u4E0B\u8F7D\u4E2D\uFF1A" + percent + "%";
            chrome.storage.local.set({ [TRANSLATOR_PROGRESS_STORAGE_KEY]: percent });
          });
        }
      });
      translator.destroy();
      renderModelStatus("\u7FFB\u8BD1\u6A21\u578B\u5DF2\u4E0B\u8F7D\u5E76\u5C31\u7EEA\u3002");
    } catch (error) {
      modelStatus.textContent = "\u4E0B\u8F7D\u5931\u8D25\uFF1A" + error.name + ": " + error.message;
      downloadButton.disabled = false;
      downloadProgress.hidden = true;
    } finally {
      await chrome.storage.local.remove(TRANSLATOR_PROGRESS_STORAGE_KEY);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
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
})();
