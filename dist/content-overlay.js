(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // core/drag.js
  var drag_exports = {};
  __export(drag_exports, {
    HOLD_MS: () => HOLD_MS,
    MOVE_SLOP_PX: () => MOVE_SLOP_PX,
    VISIBLE_EDGE_PX: () => VISIBLE_EDGE_PX,
    applyDrag: () => applyDrag,
    isBeyondSlop: () => isBeyondSlop
  });
  var HOLD_MS = 1e3;
  var MOVE_SLOP_PX = 5;
  var VISIBLE_EDGE_PX = 60;
  function isBeyondSlop(startX, startY, x, y) {
    const dx = x - startX;
    const dy = y - startY;
    return dx * dx + dy * dy > MOVE_SLOP_PX * MOVE_SLOP_PX;
  }
  function applyDrag(startRect, dx, dy, viewportW, viewportH) {
    const left = clamp(
      startRect.left + dx,
      VISIBLE_EDGE_PX - startRect.width,
      viewportW - VISIBLE_EDGE_PX
    );
    const top = clamp(
      startRect.top + dy,
      0,
      viewportH - VISIBLE_EDGE_PX
    );
    return { left, top };
  }
  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

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

  // content-overlay.js
  if (window.__echoSageOverlayLoaded) {
  } else {
    window.__echoSageOverlayLoaded = true;
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "subtitle-start") {
        liveOverlayActive = true;
        createOverlay();
      } else if (message.type === "subtitle-update") {
        liveOverlayActive = true;
        createOverlay();
        lastLiveState = message.state;
        if (!videoOverlayActive) render(message.state, "live");
      } else if (message.type === "subtitle-stop") {
        const notices = {
          "session-cap": "\u5B57\u5E55\u4F1A\u8BDD\u5DF2\u8FBE 1 \u5C0F\u65F6\u4E0A\u9650\uFF0C\u5DF2\u7ED3\u675F\u3002\u60F3\u7EE7\u7EED\uFF1A\u518D\u70B9\u4E00\u6B21\u6269\u5C55\u7684\u300C\u5F00\u59CB\u300D\u3002",
          "audio-ended": "\u97F3\u9891\u5DF2\u7ED3\u675F\uFF0C\u5B57\u5E55\u5DF2\u81EA\u52A8\u505C\u6B62\u3002"
        };
        liveOverlayActive = false;
        if (videoOverlayActive && lastVideoState) {
          createOverlay();
          renderVideo(lastVideoState);
        } else {
          showNotice(notices[message.reason] ?? "\u5B57\u5E55\u5DF2\u505C\u6B62\u3002");
          removeOverlay();
        }
      } else if (message.type === "video-subtitle-update") {
        videoOverlayActive = true;
        lastVideoState = message.state;
        createOverlay();
        renderVideo(message.state);
      } else if (message.type === "video-subtitle-stop") {
        videoOverlayActive = false;
        lastVideoState = null;
        if (liveOverlayActive && lastLiveState) {
          createOverlay();
          render(lastLiveState, "live");
        } else {
          removeOverlay();
        }
      }
    });
    chrome.runtime.sendMessage({ type: "content-script-handshake" }).then((status) => {
      if (status?.capturing) {
        liveOverlayActive = true;
        createOverlay();
      }
    }).catch(() => {
    });
  }
  var HOST_ID = "echosage-subtitle-host";
  var POS_STORAGE_KEY = "subtitlePos";
  var shadowRoot = null;
  var overlayHost = null;
  function applyAccent(color) {
    overlayHost?.style.setProperty("--echosage-accent", normalizeAccentColor(color));
  }
  var liveOverlayActive = false;
  var videoOverlayActive = false;
  var lastLiveState = null;
  var lastVideoState = null;
  function createOverlay() {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement("div");
    host.id = HOST_ID;
    shadowRoot = host.attachShadow({ mode: "closed" });
    overlayHost = host;
    applyAccent(DEFAULT_ACCENT_COLOR);
    chrome.storage.local.get({ [ACCENT_COLOR_STORAGE_KEY]: DEFAULT_ACCENT_COLOR }).then((stored) => applyAccent(stored[ACCENT_COLOR_STORAGE_KEY])).catch(() => {
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[ACCENT_COLOR_STORAGE_KEY]) return;
      applyAccent(changes[ACCENT_COLOR_STORAGE_KEY].newValue);
    });
    const style = document.createElement("style");
    style.textContent = `
    :host {
      all: initial;
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 72px;
      z-index: 2147483647;
      /* \u56FA\u5B9A\u5BBD\u5EA6\u800C\u975E max-width\uFF1A\u5BBD\u5EA6\u968F\u6587\u5B57\u957F\u5EA6\u53D8\u4F1A\u8BA9\u5B57\u5E55\u6846\u5DE6\u53F3\u547C\u5438\uFF0C
         \u76EF\u7740\u770B\u5F88\u7D2F\u3002\u5BBD\u5EA6\u9489\u6B7B\uFF0C\u53EA\u6709\u6362\u884C\u4F1A\u6539\u9AD8\u5EA6\u3002 */
      width: min(72vw, 820px);
      font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      text-align: center;
      pointer-events: none;
      color: #fff;
    }
    /* \u5B57\u5E55\u6846\uFF1A\u534A\u900F\u660E\u9ED1\u5E95\u628A\u5B57\u5E55\u4ECE\u753B\u9762\u91CC\u62AC\u51FA\u6765\uFF08\u767D\u5B57 + text-shadow \u5728
       \u6D45\u8272\u753B\u9762\u4E0A\u4ECD\u7136\u7CCA\uFF0C\u89C1\u7528\u6237\u53CD\u9988\u7684\u622A\u56FE\uFF09\u3002\u7A7A\u72B6\u6001\u6574\u6846\u9690\u85CF\uFF0C\u4E0D\u7559\u9ED1\u5757\u3002
       pointer-events: auto \u662F\u62D6\u52A8\u7684\u4EE3\u4EF7\uFF1A\u6846\u533A\u57DF\u5185\u7684\u70B9\u51FB\u4E0D\u518D\u7A7F\u900F\u5230
       \u9875\u9762\uFF08\u957F\u6309\u62D6\u52A8\u3001\u53CC\u51FB\u590D\u4F4D\u90FD\u9700\u8981\u5728\u6846\u4E0A\u6536\u5230\u6307\u9488\u4E8B\u4EF6\uFF09\u3002 */
    .box {
      display: none;
      padding: 10px 18px 11px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(2px);
      pointer-events: auto;
      user-select: none;
      touch-action: none;
      cursor: grab;
    }
    .box.visible { display: block; }
    /* \u957F\u6309\u6EE1 1s \u6FC0\u6D3B\u62D6\u52A8\uFF1A\u8FB9\u6846\u9AD8\u4EAE\u544A\u8BC9\u7528\u6237\u300C\u73B0\u5728\u53EF\u4EE5\u62D6\u4E86\u300D */
    .box.dragging {
      cursor: grabbing;
      border: 1px solid rgba(255, 255, 255, 0.7);
      opacity: 0.92;
    }
    /* \u4F1A\u8BDD\u76F8\u4F4D\uFF08\u5F85\u673A/\u91CD\u8FDE\uFF09\u662F\u72B6\u6001\u6307\u793A\u4E0D\u662F\u9519\u8BEF\u2014\u2014\u5C0F\u5B57\u6DE1\u663E\u5728\u6846\u9876 */
    .phase {
      display: none;
      font-size: 12px;
      opacity: 0.5;
      margin-bottom: 4px;
    }
    .phase.visible { display: block; }
    .phase.degraded { display: block; }
    .source {
      font-size: 14px;
      line-height: 1.35;
      opacity: 0.62;
    }
    .turn.no-translation .source {
      /* \u65E0\u8BD1\u6587\u65F6\u539F\u6587\u8F68\u5347\u4E3A\u4E3B\u89C6\u89C9\uFF08ADR-0002 \u964D\u7EA7\u5F62\u6001\uFF1A\u8BD1\u6587\u8F68\u6D88\u5931\u65F6
         \u7528\u6237\u81F3\u5C11\u8FD8\u6709\u5185\u5BB9\u53EF\u8BFB\uFF0C\u4E14\u80FD\u533A\u5206\u300C\u7FFB\u8BD1\u6162/\u574F\u4E86\u300D\u548C\u300C\u6CA1\u5728\u8DD1\u300D\uFF09 */
      font-size: 19px;
      opacity: 0.9;
    }
    /* \u767D\u5B57\u9ED1\u5E95\u662F\u53E0\u52A0\u5C42\u7684\u94C1\u5F8B\uFF08\u8BBE\u8BA1\u7A3F\uFF1A\u4EFB\u4F55\u753B\u9762\u4E0A\u90FD\u8981\u8BFB\u5F97\u6E05\uFF09\uFF0C\u5F3A\u8C03\u8272\u53EA
       \u843D\u5728\u8BD1\u6587\u8F68\u5E95\u4E0B\u90A3\u4E00\u6761 2px \u7684\u7EBF\u4E0A\u2014\u2014\u5B83\u6807\u51FA\u300C\u8FD9\u4E00\u8F68\u662F\u4E3B\u89C6\u89C9\u300D\uFF0C\u4E0D\u53BB
       \u6539\u5B57\u8272\uFF0C\u907F\u514D\u5728\u82B1\u54E8\u753B\u9762\u4E0A\u964D\u4F4E\u5BF9\u6BD4\u5EA6\u3002 */
    .translation {
      font-size: 22px;
      line-height: 1.4;
      font-weight: 600;
      margin-top: 2px;
      padding-bottom: 3px;
      box-shadow: inset 0 -2px 0 var(--echosage-accent, oklch(0.58 0.14 195));
    }
    .turn.no-translation .translation { box-shadow: none; }
    /* partial \u4E0E\u5B9A\u7A3F\u5B57\u5E55\u540C\u6846\u540C\u5E95\uFF08\u6846\u7684\u8FB9\u754C\u624D\u7A33\u5B9A\uFF09\uFF0C\u9760\u4F4E\u900F\u660E\u5EA6 + \u659C\u4F53
       \u533A\u5206\u300C\u8FD8\u6CA1\u5B9A\u7A3F\u300D\u3002\u5B83\u662F\u6D3B\u8DC3\u5EA6\u6307\u793A\uFF0C\u4E0D\u662F\u4FE1\u606F\u4F20\u9012\u3002 */
    .partial {
      display: none;
      font-size: 13px;
      line-height: 1.3;
      opacity: 0.45;
      font-style: italic;
      margin-top: 6px;
    }
    .partial.visible { display: block; }
    .notice {
      margin-top: 6px;
      font-size: 13px;
      opacity: 0.75;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    }
    .actions {
      pointer-events: auto;
      margin-top: 6px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    :host(:hover) .actions { opacity: 1; }
    .stop {
      font-size: 13px;
      padding: 4px 14px;
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      cursor: pointer;
    }
    .stop:hover { background: rgba(180, 40, 40, 0.85); }
  `;
    shadowRoot.appendChild(style);
    const box = document.createElement("div");
    box.className = "box";
    shadowRoot.appendChild(box);
    attachDragging(box);
    const phase = document.createElement("div");
    phase.className = "phase";
    box.appendChild(phase);
    const stack = document.createElement("div");
    stack.className = "stack";
    box.appendChild(stack);
    const partial = document.createElement("div");
    partial.className = "partial";
    box.appendChild(partial);
    const actions = document.createElement("div");
    actions.className = "actions";
    const stopBtn = document.createElement("button");
    stopBtn.className = "stop";
    stopBtn.textContent = "\u23F9 \u505C\u6B62\u5B57\u5E55";
    stopBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "stop-capture-request" });
      removeOverlay();
    });
    actions.appendChild(stopBtn);
    shadowRoot.appendChild(actions);
    const mount = () => {
      const target = document.fullscreenElement ?? document.body;
      if (host.parentElement !== target) target.appendChild(host);
    };
    document.addEventListener("fullscreenchange", mount);
    mount();
    chrome.storage.local.get(POS_STORAGE_KEY).then((data) => {
      const pos = data?.[POS_STORAGE_KEY];
      if (pos && shadowRoot && !host.style.left) {
        host.style.left = `${pos.left}px`;
        host.style.top = `${pos.top}px`;
        host.style.bottom = "auto";
        host.style.transform = "none";
      }
    }).catch(() => {
    });
  }
  function attachDragging(box) {
    let session = null;
    const host = () => document.getElementById(HOST_ID);
    const savePos = (left, top) => {
      chrome.storage.local.set({ [POS_STORAGE_KEY]: { left, top } }).catch(() => {
      });
    };
    const clearPos = () => {
      chrome.storage.local.remove(POS_STORAGE_KEY).catch(() => {
      });
    };
    const beginDrag = () => {
      if (!session || !drag_exports) return;
      clearTimeout(session.timer);
      session.dragging = true;
      const el = host();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.bottom = "auto";
      el.style.transform = "none";
      session.startRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      try {
        box.setPointerCapture(session.pointerId);
      } catch {
      }
      box.classList.add("dragging");
    };
    const endSession = () => {
      if (!session) return;
      clearTimeout(session.timer);
      if (session.dragging) {
        box.classList.remove("dragging");
        const el = host();
        if (el?.style.left) {
          savePos(parseFloat(el.style.left), parseFloat(el.style.top));
        }
      }
      session = null;
    };
    box.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || session) return;
      session = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRect: null,
        timer: setTimeout(beginDrag, HOLD_MS),
        dragging: false
      };
    });
    box.addEventListener("pointermove", (e) => {
      if (!session || e.pointerId !== session.pointerId) return;
      if (!session.dragging) {
        if (isBeyondSlop(session.startX, session.startY, e.clientX, e.clientY)) {
          clearTimeout(session.timer);
          session = null;
        }
        return;
      }
      const el = host();
      if (!el || !session.startRect) return;
      const { left, top } = applyDrag(
        session.startRect,
        e.clientX - session.startX,
        e.clientY - session.startY,
        window.innerWidth,
        window.innerHeight
      );
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });
    box.addEventListener("pointerup", endSession);
    box.addEventListener("pointercancel", endSession);
    box.addEventListener("dblclick", () => {
      const el = host();
      if (!el) return;
      el.style.left = "";
      el.style.top = "";
      el.style.bottom = "";
      el.style.transform = "";
      clearPos();
    });
  }
  function removeOverlay() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
    shadowRoot = null;
  }
  function showNotice(text) {
    if (!shadowRoot) return;
    let notice = shadowRoot.querySelector(".notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "notice";
      shadowRoot.appendChild(notice);
    }
    notice.textContent = text;
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => notice.remove(), 6e3);
  }
  var lastTranslationDegraded = false;
  function setOverlayMode(mode) {
    if (!shadowRoot) return;
    const actions = shadowRoot.querySelector(".actions");
    if (actions) actions.hidden = mode !== "live";
  }
  function renderVideo(state) {
    const captions = state?.captions ?? [];
    const index = Number.isInteger(state?.currentCueIndex) ? state.currentCueIndex : -1;
    const cue = captions[index];
    const translation = state?.translations?.[index] ?? cue?.translation ?? "";
    render({
      subtitle: cue ? [{ source: cue.text, translation }] : [],
      partial: "",
      phase: "",
      translationDegraded: false
    }, "video");
  }
  function render(state, mode = "live") {
    if (!shadowRoot) return;
    if (mode === "live") lastLiveState = state;
    setOverlayMode(mode);
    const box = shadowRoot.querySelector(".box");
    const stack = shadowRoot.querySelector(".stack");
    const partialEl = shadowRoot.querySelector(".partial");
    const phaseEl = shadowRoot.querySelector(".phase");
    const turns = state.subtitle ?? [];
    const turn = turns[turns.length - 1] ?? null;
    const partial = state.partial ?? "";
    const phaseText = {
      idle: "\u{1F4A4} \u5F85\u673A\u4E2D\uFF08\u672A\u68C0\u6D4B\u5230\u8BED\u97F3\uFF0C\u6682\u505C\u4E0A\u4F20\uFF09",
      reconnecting: "\u{1F504} \u8FDE\u63A5\u4E2D\u65AD\uFF0C\u81EA\u52A8\u91CD\u8FDE\u4E2D\u2026"
    }[state.phase] ?? "";
    phaseEl.textContent = state.translationDegraded ? `${phaseText ? phaseText + "\uFF5C" : ""}\u26A0\uFE0F \u7FFB\u8BD1\u4E0D\u53EF\u7528\uFF0C\u4EC5\u663E\u793A\u897F\u8BED` : phaseText;
    const phaseVisible = phaseText !== "" || state.translationDegraded;
    phaseEl.classList.toggle("visible", phaseVisible);
    if (state.translationDegraded && !lastTranslationDegraded) {
      showNotice("\u7FFB\u8BD1\u4E0D\u53EF\u7528\uFF0C\u5B57\u5E55\u5DF2\u964D\u7EA7\u4E3A\u4EC5\u897F\u8BED\u663E\u793A\u3002");
    }
    lastTranslationDegraded = state.translationDegraded;
    stack.replaceChildren();
    if (turn) {
      const wrap = document.createElement("div");
      wrap.className = turn.translation ? "turn" : "turn no-translation";
      const source = document.createElement("div");
      source.className = "source";
      source.textContent = turn.source;
      wrap.appendChild(source);
      if (turn.translation) {
        const translation = document.createElement("div");
        translation.className = "translation";
        translation.textContent = turn.translation;
        wrap.appendChild(translation);
      }
      stack.appendChild(wrap);
    }
    partialEl.textContent = partial;
    partialEl.classList.toggle("visible", partial !== "");
    box.classList.toggle(
      "visible",
      Boolean(turn) || partial !== "" || phaseVisible
    );
  }
})();
