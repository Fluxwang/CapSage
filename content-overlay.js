import * as dragCore from "./core/drag.js";

// Content Script —— 纯渲染层（ADR-0004/0006）
//
// 收到的是已经翻译好的中文 + 西语原文，它不知道 Translator 的存在。
// 在每个页面加载（<all_urls> 声明式注入），但只有被捕获的那个标签页会
// 真正创建浮层：要么 background 在开始捕获时投来 subtitle-start /
// subtitle-update，要么加载时握手拿到 capturing: true（捕获进行中被硬
// 导航重新注入的状态恢复路径）。其余页面挂着一个监听器、不碰 DOM。

// 重复注入保护：background 在开始捕获时会对没有响应的标签页补一次
// scripting.executeScript（开发期 reload 扩展后声明式注入的那份已成孤儿），
// 万一两份都在，第二份直接退出，不要挂两套监听器。
if (window.__echoSageOverlayLoaded) {
  // already loaded
} else {
  window.__echoSageOverlayLoaded = true;

  // 监听器无条件注册（不能等握手结果）：常见用法是页面先开着、
  // 之后才在 popup 点开始，握手那一刻 capturing 必然是 false，
  // 早退就等于这个标签页永远收不到字幕（浮层从来不出现的原因）。
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "subtitle-start") {
      liveOverlayActive = true;
      createOverlay();
    } else if (message.type === "subtitle-update") {
      // 兜底：先于 subtitle-start 到达也能显示
      liveOverlayActive = true;
      createOverlay();
      lastLiveState = message.state;
      // 视频悬浮窗是用户显式打开的模式；同页碰巧也有直播会话时，直到
      // 用户关掉视频悬浮窗前都保持视频 cue 为主。
      if (!videoOverlayActive) render(message.state, "live");
    } else if (message.type === "subtitle-stop") {
      // 终止原因用一次性角标说明（session-cap 时告诉用户可重新开始），
      // 不常驻浮层。角标自身的 6 秒自灭就是唯一的清理 owner——浮层
      // 立即移除会把角标一起带走，所以这里只挡新字幕进来。
      const notices = {
        "session-cap": "字幕会话已达 1 小时上限，已结束。想继续：再点一次扩展的「开始」。",
        "audio-ended": "音频已结束，字幕已自动停止。",
      };
      liveOverlayActive = false;
      if (videoOverlayActive && lastVideoState) {
        createOverlay();
        renderVideo(lastVideoState);
      } else {
        showNotice(notices[message.reason] ?? "字幕已停止。");
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

  // 状态恢复路径：捕获进行中页面被硬导航时本脚本会被重新注入，
  // 主动问 background 这个标签页是否正在被捕获。只有被捕获的那个
  // 标签页会得到 capturing: true（background 比对 sender.tab.id）。
  // 不补历史，浮层从空开始，等第一条 subtitle-update。
  chrome.runtime
    .sendMessage({ type: "content-script-handshake" })
    .then((status) => {
      if (status?.capturing) {
        liveOverlayActive = true;
        createOverlay();
      }
    })
    .catch(() => {});
}

// ---- 浮层 ----

const HOST_ID = "echosage-subtitle-host";
const POS_STORAGE_KEY = "subtitlePos";
let shadowRoot = null;
let liveOverlayActive = false;
let videoOverlayActive = false;
let lastLiveState = null;
let lastVideoState = null;
// 拖动几何来自 core/（唯一的纯逻辑测试 seam）。esbuild 会将其并入入口。

function createOverlay() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  shadowRoot = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  // 全部样式内联在 Shadow DOM 里：宿主页面的 CSS 进不来（选择器打不进
  // shadow tree），我们的类名也出不去（不会污染宿主）。
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 72px;
      z-index: 2147483647;
      /* 固定宽度而非 max-width：宽度随文字长度变会让字幕框左右呼吸，
         盯着看很累。宽度钉死，只有换行会改高度。 */
      width: min(72vw, 820px);
      font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      text-align: center;
      pointer-events: none;
      color: #fff;
    }
    /* 字幕框：半透明黑底把字幕从画面里抬出来（白字 + text-shadow 在
       浅色画面上仍然糊，见用户反馈的截图）。空状态整框隐藏，不留黑块。
       pointer-events: auto 是拖动的代价：框区域内的点击不再穿透到
       页面（长按拖动、双击复位都需要在框上收到指针事件）。 */
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
    /* 长按满 1s 激活拖动：边框高亮告诉用户「现在可以拖了」 */
    .box.dragging {
      cursor: grabbing;
      border: 1px solid rgba(255, 255, 255, 0.7);
      opacity: 0.92;
    }
    /* 会话相位（待机/重连）是状态指示不是错误——小字淡显在框顶 */
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
      /* 无译文时原文轨升为主视觉（ADR-0002 降级形态：译文轨消失时
         用户至少还有内容可读，且能区分「翻译慢/坏了」和「没在跑」） */
      font-size: 19px;
      opacity: 0.9;
    }
    .translation {
      font-size: 22px;
      line-height: 1.4;
      font-weight: 600;
      margin-top: 2px;
    }
    /* partial 与定稿字幕同框同底（框的边界才稳定），靠低透明度 + 斜体
       区分「还没定稿」。它是活跃度指示，不是信息传递。 */
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

  // 一个框装下当前字幕 + partial：两者同框，框的上下边界只随文字换行动，
  // 不随「历史攒了几条」动（历史滚动会把框顶得越来越高，见用户反馈）。
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
  stopBtn.textContent = "⏹ 停止字幕";
  stopBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "stop-capture-request" });
    removeOverlay();
  });
  actions.appendChild(stopBtn);
  shadowRoot.appendChild(actions);

  // 全屏重挂载：页面某个子树进入全屏时，挂在 document 根上的浮层不会
  // 跟着进全屏层、整个消失。监听变化，把 host 挂到当前全屏元素下
  // （退出全屏则挂回 body）。fixed 定位在两种父级下都有效。
  const mount = () => {
    const target = document.fullscreenElement ?? document.body;
    if (host.parentElement !== target) target.appendChild(host);
  };
  document.addEventListener("fullscreenchange", mount);
  mount();

  // 位置恢复：上次拖动保存的位置优先于 CSS 默认（底部居中）。
  // content script 有 chrome.storage（只有 offscreen 文档没有）。
  chrome.storage.local
    .get(POS_STORAGE_KEY)
    .then((data) => {
      const pos = data?.[POS_STORAGE_KEY];
      // 只在浮层还活着且用户没有拖过（无内联位置）时套用：
      // 硬导航重注入、下一次开始字幕都走这里。
      if (pos && shadowRoot && !host.style.left) {
        host.style.left = `${pos.left}px`;
        host.style.top = `${pos.top}px`;
        host.style.bottom = "auto";
        host.style.transform = "none";
      }
    })
    .catch(() => {});
}

// ---- 长按拖动 + 双击复位 ----
//
// 交互：按住字幕框满 HOLD_MS（1s）进入拖动模式（边框高亮 + grabbing），
// 松开结束并存位置；按住期间移动超过 MOVE_SLOP_PX 取消（滚动/划过
// 不误触发）；双击复位到默认底部居中并清除保存的位置。
// 位置计算委托 core/drag.js（纯函数），这里只做事件编排和样式写回。

function attachDragging(box) {
  // 拖动会话状态；pointer 事件在 box 上，位置写在 host 上（:host 才是
  // fixed 定位的那个元素）。
  let session = null; // { pointerId, startX, startY, startRect, timer, dragging }

  const host = () => document.getElementById(HOST_ID);

  const savePos = (left, top) => {
    chrome.storage.local.set({ [POS_STORAGE_KEY]: { left, top } }).catch(() => {});
  };

  const clearPos = () => {
    chrome.storage.local.remove(POS_STORAGE_KEY).catch(() => {});
  };

  const beginDrag = () => {
    if (!session || !dragCore) return;
    clearTimeout(session.timer);
    session.dragging = true;
    const el = host();
    if (!el) return;
    // 钉住当前位置：默认定位是 bottom + translateX(-50%)，拖动改用
    // 显式 left/top，先固化再开始增量更新，否则第一帧会跳。
    const rect = el.getBoundingClientRect();
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.bottom = "auto";
    el.style.transform = "none";
    // startRect 也换成钉住后的（left/top 已内联，getBoundingClientRect
    // 的返回即拖动基线）
    session.startRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    try {
      box.setPointerCapture(session.pointerId);
    } catch {
      // 指针已消失（罕见）：拖动仍可进行，只是可能收不到 move
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
    // 只响应主键；二次按下时若已在拖动则忽略
    if (e.button !== 0 || session) return;
    session = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRect: null,
      timer: setTimeout(beginDrag, dragCore.HOLD_MS),
      dragging: false,
    };
  });

  box.addEventListener("pointermove", (e) => {
    if (!session || e.pointerId !== session.pointerId) return;
    if (!session.dragging) {
      // 按住等待期：移动超过容差 = 用户不是在长按，取消
      if (dragCore.isBeyondSlop(session.startX, session.startY, e.clientX, e.clientY)) {
        clearTimeout(session.timer);
        session = null;
      }
      return;
    }
    const el = host();
    if (!el || !session.startRect) return;
    const { left, top } = dragCore.applyDrag(
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
    // 双击 = 两次快速 down/up，每次都在 1s 内取消长按，不会触发拖动；
    // 这里只需复位。拖动中不会出现 dblclick（pointerup 已结束会话）。
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

// 一次性角标：终止原因的说明（ADR-0002：不要在主视觉位置常驻错误文案）
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
  notice._timer = setTimeout(() => notice.remove(), 6000);
}

// state: { subtitle: [{source, translation}], partial, phase, translationDegraded }
// 只渲染最新的那一条话轮。reducer 仍然保留 2 条窗口（晚到译文要能对上
// 已经入队的话轮），但浮层里只显示一条——直播不停说，多条堆叠会把框
// 一直往上顶，成为读不完也定不住的滚动条。
let lastTranslationDegraded = false;

function setOverlayMode(mode) {
  if (!shadowRoot) return;
  const actions = shadowRoot.querySelector(".actions");
  if (actions) actions.hidden = mode !== "live";
}

// 视频输入已经是带时间戳的静态 cue 列表；content-tiktok 用 core/playback.js
// 采样出的 currentCueIndex 选择当前行，再把同一种双轨数据结构交给渲染器。
// 因而 live 的增量话轮路径与视频静态路径共享样式、拖动和位置持久化行为。
function renderVideo(state) {
  const captions = state?.captions ?? [];
  const index = Number.isInteger(state?.currentCueIndex) ? state.currentCueIndex : -1;
  const cue = captions[index];
  const translation = state?.translations?.[index] ?? cue?.translation ?? "";
  render({
    subtitle: cue ? [{ source: cue.text, translation }] : [],
    partial: "",
    phase: "",
    translationDegraded: false,
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

  // 相位指示（待机/重连是状态不是错误，persistent 小字即可；capturing
  // 不显示）。降级是持续状态，常驻小字提示但不再升级为主视觉
  const phaseText = {
    idle: "💤 待机中（未检测到语音，暂停上传）",
    reconnecting: "🔄 连接中断，自动重连中…",
  }[state.phase] ?? "";
  phaseEl.textContent = state.translationDegraded
    ? `${phaseText ? phaseText + "｜" : ""}⚠️ 翻译不可用，仅显示西语`
    : phaseText;
  const phaseVisible = phaseText !== "" || state.translationDegraded;
  phaseEl.classList.toggle("visible", phaseVisible);

  // 降级一次性角标（ADR-0002：说明只出现一次，不常驻主视觉位置）
  if (state.translationDegraded && !lastTranslationDegraded) {
    showNotice("翻译不可用，字幕已降级为仅西语显示。");
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

    // 译文轨是主视觉，只在有译文时渲染（未翻完/翻译失败不占位）
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
  // 无字幕也无 partial 时整框隐藏：否则画面上留一个空黑块
  // （待机/重连/降级指示本身也要让框可见）
  box.classList.toggle(
    "visible",
    Boolean(turn) || partial !== "" || phaseVisible
  );
}
