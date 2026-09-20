// Offscreen Document —— 实际处理 tabCapture 拿到的音频流
//
// 音频结构（ADR-0001）：两个 AudioContext 共用同一个 MediaStream——
//   1. 回放链路：默认采样率 source → destination，把被 tabCapture 静音的
//      原声接回扬声器
//   2. 转写链路：16kHz source → AudioWorklet → gain(0) → destination，
//      worklet 产出 PCM16 音频块（数值逻辑在 core/audio.js）
//
// 音频块经 WebSocket 发往 AssemblyAI（v3 universal streaming，按会话源语言）：
// 浏览器 WebSocket 不能带 Authorization 头，所以每次连接前先用 Key 换
// 一次性临时 token 拼进 URL（ADR-0005：这是绕开 Web 标准限制，不是安全机制）。
//
// 本文件是会话 reducer 的宿主：捕获状态全部收拢在 core/session.js 的
// 纯 reducer 里，这里只负责把浏览器事件翻译成 reducer 事件、把 reducer
// 返回的指令翻译成实际副作用。注意 dispatch 在消息监听器的同步调用栈里
// 完成「inactive → capturing」的转移——原来靠同步锁挡住的并发重复 start，
// 现在由这个同步转移承担，行为不能退化。

import { rmsToVolumePercent } from "./core/audio.js";
import {
  createSessionState,
  sessionReducer,
  SESSION_CAP_SECONDS,
  classifyAsrError,
} from "./core/session.js";
import { sessionEndMessages } from "./core/messages.js";
import { DEFAULT_SOURCE_LANGUAGE, TARGET_LANGUAGE } from "./shared/settings.js";

// 会话时长硬上限：把一次「忘记关闭」的损失钉死（ADR-0005）。与
// SESSION_CAP_SECONDS 是同一个值的两处表达——URL 在这里拼，常量从
// core/ 导入，改一处两边同步。
const TOKEN_ENDPOINT =
  "https://streaming.assemblyai.com/v3/token" +
  `?expires_in_seconds=60&max_session_duration_seconds=${SESSION_CAP_SECONDS}`;

let playbackContext;
let asrContext;
let mediaStream;
let asrChunkNode;
let asrSocket;
let tickTimerId = null;
// offscreen document 里没有 chrome.storage（实测为 undefined），Key 由
// background 读取后随 start-capture 消息传入
let apiKey;
// 每次会话由 background 传入。offscreen 无法读取 chrome.storage，因此不能
// 在这里自行取设置；它只消费随 user-start 固定下来的语言值。
let sourceLanguage = DEFAULT_SOURCE_LANGUAGE;
// 翻译器实例整个捕获会话只建一次、复用到停止（ADR-0004：模型就绪时
// offscreen 无需用户手势即可创建；实例与捕获会话同生死）
let translator;

let sessionState = createSessionState();
// 视频场景和直播场景各自拥有 reducer、音频图、socket、计时器和翻译器。
// 不复用上面的单例变量：两个标签页可以同时转写，任何一个停止都不能释放
// 另一个场景的 AudioContext 或按错另一个场景的费用上限。
const videoSessions = new Map();

function dispatch(event) {
  const result = sessionReducer(sessionState, event);
  const prevPhase = sessionState.status;
  sessionState = result.state;

  if (sessionState.status !== prevPhase) {
    // 进入 reconnecting 没有伴随指令（退避到期才发 open-socket），相位
    // 变化本身就要让 popup 知道——否则到第一次重连前 popup 都是聋的
    if (sessionState.status === "reconnecting") {
      reportStatus(
        `🔄 连接中断，自动重连中（已重试 ${sessionState.reconnectAttempts} 次，最多 5 次）…`
      );
    }
    // 相位变化（capturing/idle/reconnecting）要尽快让浮层知道——话轮消息
    // 在静音期间不会来，光靠 reportTranscript 浮层会一直显示旧相位
    reportTranscript();
  }
  return result.commands;
}

function executeCommand(command) {
  if (command.type === "start-capture") {
    startCapture(command.streamId).catch((err) => {
      console.error("音频捕获失败:", err);
      // 捕获建立失败要释放状态与已建到一半的资源（含翻译器实例——它与
      // 捕获会话同生死，ADR-0004），否则后续请求会被误判成"已在捕获中"
      releaseAudio();
      releaseTranslator();
      handle({ type: "capture-failed" });
      if (!err.blocked) {
        reportStatus(`❌ 捕获失败: ${err.message}`);
      }
    });
  } else if (command.type === "stop-capture") {
    stopCapture();
  } else if (command.type === "session-ended") {
    // 会话终止的统一收尾：计时器停止（停止/释放资源由前序指令完成）
    stopTickTimer();
    reportStatus(sessionEndMessages[command.reason] ?? "⏹ 会话已结束。");
    chrome.runtime
      .sendMessage({ type: "session-ended", reason: command.reason })
      .catch(() => {});
  } else if (command.type === "open-socket") {
    const attempt = sessionState.reconnectAttempts;
    if (command.reason === "voice-resumed") {
      reportStatus("🎤 检测到语音，恢复转写连接…");
    } else if (command.reason === "retry") {
      reportStatus(`🔄 网络重连中（第 ${attempt} 次）…`);
    }
    openAsrSocket().catch((err) => {
      console.error("转写连接建立失败:", err);
      handle({
        type: "socket-error",
        error: { kind: err.authError ? "auth" : "network", message: err.message },
      });
    });
  } else if (command.type === "translate") {
    // 定稿话轮的异步翻译（ADR-0002）：失败只降级、不影响转写
    translateTurn(command.turnIndex, command.text);
  } else if (command.type === "close-socket") {
    if (command.reason === "idle") {
      reportStatus("💤 待机中：连续 60 秒未检测到语音，已暂停上传（不再计费）。有声音会自动恢复。");
    }
    closeAsrSocket();
  } else if (command.type === "translation-degraded") {
    // 一次性提示（reducer 保证只发一次）；浮层由 subtitle-relay 的
    // translationDegraded 标志做一次性角标
    reportStatus("⚠️ 翻译不可用，字幕已降级为仅西语。西语转写不受影响。");
    reportTranscript();
  } else if (command.type === "send-audio") {
    // reducer 只在连接 open 时产出本指令；此处 socket 可能恰在关闭瞬间，
    // send 前再确认一次 readyState
    if (asrSocket && asrSocket.readyState === WebSocket.OPEN) {
      asrSocket.send(command.chunk);
    }
  }
}

function handle(event) {
  const commands = dispatch(event);
  for (const command of commands) executeCommand(command);
  return commands;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === "get-state") {
    // background 在重复 start 前查询（避免撞 tabCapture 锁），同步应答
    sendResponse(sessionState);
    return;
  }

  if (message.type === "get-capture-status") {
    const activeStatuses = new Set(["capturing", "idle", "reconnecting"]);
    sendResponse({
      liveStatus: sessionState.status,
      videoActive: [...videoSessions.values()].some((session) =>
        activeStatuses.has(session.state.status)
      ),
    });
    return;
  }

  if (message.type === "start-capture") {
    apiKey = message.apiKey;
    // start-capture/open-socket 指令会在下方同步 dispatch 后立刻开始执行，
    // 所以语言也必须在 dispatch 前写好；否则异步建翻译器或 WebSocket 会
    // 错用上一场会话（或默认）的语言。
    const startingFreshSession = sessionState.status === "inactive";
    if (startingFreshSession) sourceLanguage = message.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
    // dispatch 必须留在同步调用栈里（见文件头注释）：inactive→capturing 的
    // 转移要发生在任何 await 之前，否则并发重复 start 的保护退化。
    // 翻译模型就绪检查在 start-capture 指令的执行里做，失败走 capture-failed。
    const commands = handle({
      type: "user-start",
      streamId: message.streamId,
      translateTrigger: message.translateTrigger,
      sourceLanguage: message.sourceLanguage,
    });
    if (startingFreshSession) sourceLanguage = sessionState.sourceLanguage;
    if (commands.length === 0) {
      reportStatus("ℹ️ 已经在捕获中，忽略重复请求");
    }
  } else if (message.type === "stop-capture") {
    handle({ type: "user-stop" });
  } else if (message.type === "start-video-capture") {
    const existing = videoSessions.get(message.sessionId);
    if (existing) {
      existing.start();
    } else {
      const session = new VideoCaptureSession(message);
      videoSessions.set(message.sessionId, session);
      session.start();
    }
    sendResponse({ ok: true });
    return;
  } else if (message.type === "stop-video-capture") {
    videoSessions.get(message.sessionId)?.stop(message.reason);
    sendResponse({ ok: true });
    return;
  } else if (message.type === "set-video-translation-engine") {
    videoSessions.get(message.sessionId)?.setTranslationEngine(message.translationEngine);
    sendResponse({ ok: true });
    return;
  } else if (message.type === "complete-video-batch-translation") {
    videoSessions.get(message.sessionId)?.completeBatchTranslation(message.translations);
    sendResponse({ ok: true });
    return;
  } else if (message.type === "get-video-state") {
    sendResponse(videoSessions.get(message.sessionId)?.snapshot() ?? null);
    return;
  } else if (message.type === "translate-video-units") {
    // 视频原生字幕的本地翻译不是直播会话的一部分。它必须创建一个短命的
    // Translator，不能复用或改写直播会话的 translator/sourceLanguage——两个
    // 场景可能同时运行，而且各自选中的源语言也可能不同。
    translateVideoUnits(message.units, message.sourceLanguage)
      .then((translations) => sendResponse({ ok: true, data: { translations } }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "本地翻译失败。" }));
    return true;
  }
});

function reportStatus(status) {
  chrome.runtime.sendMessage({ type: "capture-status", status });
}

// 音量换算已迁入核心模块 core/audio.js（rmsToVolumePercent）。

async function startCapture(streamId) {
  // 并发重复 start 的保护已上移到 reducer：dispatch 在消息监听器的同步
  // 调用栈里完成 inactive → capturing 转移，所以本函数不会重入——否则
  // 同一个 tab 会被捕获两次、建出两套音频图。

  // 每次启动都检查翻译模型是否就绪（ADR-0004：模型可能被用户卸载或被
  // 系统清理，不是一次性的引导步骤）。未就绪必须拦住并引导去设置页
  // 下载——offscreen 永远触发不了下载（无用户手势）。blocked 标记让
  // 外层 catch 知道引导消息已发出、不再重复报"捕获失败"。
  const ready = await ensureTranslatorReady();
  if (!ready) {
    const err = new Error("翻译模型未就绪");
    err.blocked = true;
    throw err;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  const track = mediaStream.getAudioTracks()[0];
  console.log("[EchoSage] audio track:", track && {
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  });

  // track 在启动后是否会偷偷变哑/结束。ended 不是日志事件：用户关掉了
  // 被捕获的标签页或直播断流——继续持有连接是纯粹浪费（ADR-0005），
  // 必须触发完整停止
  track.addEventListener("mute", () => console.log("[EchoSage] ⚠️ track 事件: mute（流变静音）"));
  track.addEventListener("unmute", () => console.log("[EchoSage] track 事件: unmute"));
  track.addEventListener("ended", () => {
    console.log("[EchoSage] track 事件: ended（流已结束）");
    handle({ type: "audio-track-ended" });
  });

  // ---- 双 AudioContext，共用同一个 MediaStream（ADR-0001）----
  //
  // 回放链路：默认采样率（通常 48kHz），source → destination 直接透传。
  // tabCapture 会静音原标签页，这条链路把原声接回去；不走任何会降采样的
  // 节点，保真还原。看到「两个 AudioContext」不要合并——合并 = 回放被砍
  // 到 8kHz 带宽，人声变闷，这是刻意的分离。
  playbackContext = new AudioContext();
  if (playbackContext.state === "suspended") {
    await playbackContext.resume();
  }
  playbackContext
    .createMediaStreamSource(mediaStream)
    .connect(playbackContext.destination);

  // 转写链路：16kHz，source → AudioWorklet → gain(0) → destination。
  // worklet 产出 PCM16 音频块；数值逻辑（降混/夹逼/累积/RMS）全部在
  // core/audio.js，这里只接线。末端的 gain(0) 不是可选项：Web Audio 是
  // 拉取模型，worklet 必须有一条通向 destination 的（静音的）路径才会被
  // 驱动——死胡同节点永远不会跑，跟之前 AnalyserNode 踩过的是同一个坑。
  asrContext = new AudioContext({ sampleRate: 16000 });
  if (asrContext.state === "suspended") {
    await asrContext.resume();
  }
  await asrContext.audioWorklet.addModule(
    chrome.runtime.getURL("dist/asr-worklet.js")
  );
  asrChunkNode = new AudioWorkletNode(asrContext, "asr-chunker");
  asrChunkNode.port.onmessage = (event) => {
    const { rms, chunk } = event.data;
    handle({ type: "audio-chunk", rms, chunk });
    // 音量行只在转写进行中播报——待机/重连期间它会以每 64ms 一次的频率
    // 盖掉「待机中」「重连中」这些相位提示
    if (sessionState.status === "capturing") {
      const volumePercent = rmsToVolumePercent(rms);
      reportStatus(
        `🔊 音量: ${"█".repeat(Math.round(volumePercent / 5))} ${volumePercent}%` +
          `｜已产出音频块 #${sessionState.chunkCount}`
      );
    }
  };
  const mute = asrContext.createGain();
  mute.gain.value = 0;
  asrContext.createMediaStreamSource(mediaStream).connect(asrChunkNode);
  asrChunkNode.connect(mute);
  mute.connect(asrContext.destination);

  startTickTimer();
  reportStatus("✅ 已开始捕获（回放 + 转写双链路），实时音量如下：");
}

// 开发阶段经常需要刷新扩展（chrome://extensions），这会直接销毁 offscreen
// 文档、丢掉 mediaStream/两个 context 的内存引用，但不会释放浏览器底层对该
// tab 的 capture 占用（那只能靠 track.stop() 触发）。加这个监听，让文档被
// 卸载时把流停掉，避免下次捕获报 "Cannot capture a tab with an active stream"。
window.addEventListener("unload", () => {
  closeAsrSocket();
  releaseAudio();
  releaseTranslator();
  for (const videoSession of videoSessions.values()) {
    videoSession.closeSocket();
    videoSession.stopCapture();
  }
});

function releaseAudio() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (asrChunkNode) {
    asrChunkNode.port.onmessage = null;
    asrChunkNode = null;
  }
  if (asrContext) {
    asrContext.close();
    asrContext = null;
  }
  if (playbackContext) {
    playbackContext.close();
    playbackContext = null;
  }
}

function stopCapture() {
  stopTickTimer();
  releaseAudio();
  releaseTranslator();
}

// ---- 会话计时（tick 事件驱动，reducer 不读系统时钟）----

function startTickTimer() {
  // 隐藏文档里 setInterval 会被节流但照常执行；1 秒粒度对「跑了多久」
  // 的显示和 1 小时上限都足够
  tickTimerId = setInterval(() => {
    // handle 已负责执行 reducer 发出的指令。重复执行会让到达会话上限时的
    // stop / session-ended 副作用跑两次。
    handle({ type: "tick", dtSeconds: 1 });
    reportSessionTime();
  }, 1000);
}

function stopTickTimer() {
  if (tickTimerId) {
    clearInterval(tickTimerId);
    tickTimerId = null;
  }
}

function reportSessionTime() {
  // popup 关闭时发不出去，忽略即可；重开 popup 由 get-state 快照补看
  chrome.runtime
    .sendMessage({
      type: "session-time",
      seconds: sessionState.sessionSeconds,
    })
    .catch(() => {});
}

// ---- 翻译（浏览器内置 Translator，ADR-0003/0004）----

function languagePair() {
  return { sourceLanguage, targetLanguage: TARGET_LANGUAGE };
}

// 启动捕获的前置检查：availability() 必须是 available。downloadable /
// downloading 状态下 create() 需要用户手势，offscreen 永远拿不到——
// 拦住并引导用户去设置页（那里有带手势的下载按钮）。
async function ensureTranslatorReady() {
  if (!("Translator" in self)) {
    reportBlocked("当前浏览器不支持内置翻译，无法做中文翻译。可用：Chrome 138+ / Edge 148+。");
    return false;
  }
  const pair = languagePair();
  const availability = await Translator.availability(pair);
  if (availability !== "available") {
    reportBlocked(
      `翻译模型未就绪（可能未下载或被清理）。请到扩展设置页下载当前语言对（${sourceLanguage}→${TARGET_LANGUAGE}）后再开始。`
    );
    return false;
  }
  try {
    // 就绪状态下无需用户手势（ADR-0004 实测结论）；实例留到会话结束销毁
    translator = await Translator.create(pair);
    return true;
  } catch (err) {
    console.error("创建翻译器失败:", err);
    reportBlocked(`创建翻译器失败：${err.name}: ${err.message}。可尝试重启浏览器或到设置页重新下载模型。`);
    return false;
  }
}

function releaseTranslator() {
  if (translator) {
    translator.destroy();
    translator = null;
  }
}

async function translateVideoUnits(units, requestedSourceLanguage) {
  if (!Array.isArray(units) || units.length === 0) return [];
  if (!("Translator" in self)) {
    throw new Error("当前浏览器不支持内置翻译。请使用 Chrome 138+ 或 Edge 148+。");
  }

  const pair = {
    sourceLanguage: requestedSourceLanguage || DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: TARGET_LANGUAGE,
  };
  const availability = await Translator.availability(pair);
  if (availability !== "available") {
    throw new Error("当前语言对的本地翻译模型未就绪。请到设置页下载模型后重试。");
  }

  let videoTranslator;
  try {
    videoTranslator = await Translator.create(pair);
    const translations = [];
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index] ?? {};
      const text = String(unit.text ?? "").trim();
      translations.push({
        index: Number.isInteger(unit.index) ? unit.index : index,
        text: text ? await videoTranslator.translate(text) : "",
      });
    }
    return translations;
  } finally {
    videoTranslator?.destroy();
  }
}

async function translateTurn(turnIndex, text) {
  if (!translator) return;
  try {
    const translation = await translator.translate(text);
    handle({ type: "translation-done", turnIndex, text: translation });
    reportTranscript();
  } catch (err) {
    // 翻译失败 → 静默降级（ADR-0002）：译文轨消失、原文轨升主视觉、
    // 西语转写照常滚动。reducer 只在首次失败时发一次提示，不吵整场
    console.error("翻译失败:", err);
    handle({ type: "translation-failed" });
    reportTranscript();
  }
}

function reportBlocked(message) {
  chrome.runtime
    .sendMessage({ type: "capture-blocked", reason: "translator-unavailable", message })
    .catch(() => {});
}

// ---- AssemblyAI 转写连接（v3 universal streaming）----

async function openAsrSocket() {
  // Key 由 background 随 start-capture 消息传入（offscreen 没有 chrome.storage）
  if (!apiKey) {
    throw new Error("尚未配置 AssemblyAI Key，请到设置页填写");
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    headers: { Authorization: apiKey },
  });
  if (!response.ok) {
    // 401/403 = Key 本身的问题（无效/余额耗尽），重连注定失败——标记为
    // 鉴权类，reducer 会立即终止而不是退避重试（ADR-0005 最贵的 bug）
    const err = new Error(`换取临时 token 失败（HTTP ${response.status}）`);
    if (response.status === 401 || response.status === 403) {
      err.authError = true;
    }
    throw err;
  }
  const { token } = await response.json();

  // 参数沿用 Node 脚本里验证过的组合：按当前源语言锁定单语种、universal-3-5-pro、
  // PCM16/16kHz（默认编码即 pcm_s16le，无需显式声明）、开启话轮格式化——
  // 字幕场景需要标点，标点对中文译文质量的影响大于那点延迟（ADR-0002）。
  const params = new URLSearchParams({
    token,
    sample_rate: "16000",
    format_turns: "true",
    speech_model: "universal-3-5-pro",
    language_codes: JSON.stringify([sourceLanguage]),
  });
  const socket = new WebSocket(
    `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`
  );
  asrSocket = socket;

  // 竞态防护：user-stop / capture-failed 可能落在上面的 await 期间——那时
  // close-socket 看到的 asrSocket 还是空的、成了空操作，而本函数仍会把
  // 连接建起来。孤儿连接按连接时长持续计费（ADR-0005），所以建好后的第一
  // 件事就是核对会话是否还活着，不活着就立刻取消连接。
  if (sessionState.status !== "capturing") {
    asrSocket = null;
    socket.close();
    return;
  }

  socket.onopen = () => {
    reportStatus("🔗 转写连接已建立");
  };
  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "Begin") {
      handle({ type: "socket-open" });
      reportTranscript();
    } else if (msg.type === "Turn" && msg.transcript) {
      handle({
        type: "asr-turn",
        transcript: msg.transcript,
        endOfTurn: Boolean(msg.end_of_turn),
        formatted: Boolean(msg.turn_is_formatted),
      });
      reportTranscript();
    } else if (msg.type === "Error") {
      // 服务端在关闭前先发 Error 帧（携带 error_code）——用真实错误码
      // 分类（鉴权类立即终止 / 网络类退避），随后的 close 由 reducer 的
      // 期望标记吸收，不会二次触发重连
      const kind = classifyAsrError(msg.error_code);
      handle({ type: "socket-error", error: { kind, code: msg.error_code, message: msg.error } });
      if (kind === "auth") {
        console.error("[EchoSage] 转写服务报错（终止类）:", msg.error_code, msg.error);
      }
    } else if (msg.type === "Termination") {
      // 会话被服务端正常收尾（含我方主动 Terminate 之后）
      handle({ type: "socket-close" });
    }
  };
  // 不挂 onerror：浏览器错误后必然跟着 onclose，onerror 上又拿不到错误码，
  // 挂两处会把同一次断连当成两次错误（退避计数翻倍）
  socket.onclose = (event) => {
    if (asrSocket === socket) asrSocket = null;
    // close 码分类；1006（异常关闭）等网络类由 reducer 走退避重连，
    // 计划内关闭（idle 断连/终止）由 reducer 的 socketCloseExpected 吸收
    const kind = classifyAsrError(event.code);
    if (kind === "auth") {
      handle({ type: "socket-error", error: { kind, code: event.code } });
    } else {
      handle({ type: "socket-close" });
    }
  };
}

function closeAsrSocket() {
  if (!asrSocket) return;
  const socket = asrSocket;
  asrSocket = null;
  // 未主动关闭的会话会被按全时长计费——先发终止信号再关
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "Terminate" }));
  }
  socket.close();
}

function reportTranscript() {
  // 字幕状态（双轨 + partial + 会话相位）经 background 中继给被捕获标签页
  // 的浮层。popup 的调试视图走同一条数据。
  // turns 就是字幕窗口（最近 SUBTITLE_HISTORY 条，ticket 06 起与字幕同窗）
  const state = {
    subtitle: sessionState.turns,
    partial: sessionState.partial,
    phase: sessionState.status,
    translationDegraded: sessionState.translationDegraded,
  };
  chrome.runtime
    .sendMessage({ type: "subtitle-relay", state })
    .catch(() => {});
  chrome.runtime
    .sendMessage({
      type: "transcript-update",
      partial: sessionState.partial,
      turns: sessionState.turns,
    })
    .catch(() => {});
}

// ---- 视频场景：独立的流式 ASR 会话 ----
//
// 直播旧路径保持上面的单例实现，以免改变已经验证过的浮层时序。视频走这个
// 实例化宿主；它复用同一个 reducer 和双 AudioContext 拓扑，但每个实例只
// 管一个 TikTok 视频，天然支持与直播并发。

class VideoCaptureSession {
  constructor({
    sessionId,
    tabId,
    videoId,
    streamId,
    apiKey: sessionApiKey,
    sourceLanguage: requestedSourceLanguage,
    translateTrigger,
    translationEngine,
  }) {
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.videoId = videoId;
    this.streamId = streamId;
    this.apiKey = sessionApiKey;
    this.sourceLanguage = requestedSourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
    this.translateTrigger = translateTrigger;
    this.translationEngine = translationEngine;
    this.state = createSessionState();
    this.playbackContext = null;
    this.asrContext = null;
    this.mediaStream = null;
    this.asrChunkNode = null;
    this.socket = null;
    this.translator = null;
    this.tickTimerId = null;
    this.translationError = "";
    this.cleanupTimerId = null;
  }

  start() {
    this.handle({
      type: "user-start",
      streamId: this.streamId,
      scene: "video",
      sourceLanguage: this.sourceLanguage,
      translateTrigger: this.translateTrigger,
      translationEngine: this.translationEngine,
    });
  }

  stop(reason = "user-stop") {
    this.handle({
      type: reason === "video-playthrough" ? "video-playthrough-complete" : "user-stop",
    });
  }

  setTranslationEngine(translationEngine) {
    this.translationError = "";
    this.handle({ type: "set-translation-engine", translationEngine });
  }

  completeBatchTranslation(translations) {
    this.translationError = "";
    this.handle({ type: "batch-translation-done", translations });
    this.scheduleCleanup();
  }

  handle(event) {
    const priorStatus = this.state.status;
    const result = sessionReducer(this.state, event);
    this.state = result.state;

    // 64ms 一个 audio-chunk，不能每块都把完整字幕账本发回页面；话轮、译文、
    // 相位变化和用户操作才是 UI 需要的状态边界。
    if (event.type !== "audio-chunk" && event.type !== "tick" || priorStatus !== this.state.status) {
      this.emitState();
    }
    for (const command of result.commands) this.execute(command);
    return result.commands;
  }

  execute(command) {
    if (command.type === "start-capture") {
      this.startCapture().catch((error) => this.captureFailed(error));
    } else if (command.type === "stop-capture") {
      this.stopCapture();
    } else if (command.type === "open-socket") {
      this.openSocket().catch((error) => {
        console.error("视频转写连接建立失败:", error);
        this.handle({
          type: "socket-error",
          error: { kind: error.authError ? "auth" : "network", message: error.message },
        });
      });
    } else if (command.type === "close-socket") {
      this.closeSocket();
    } else if (command.type === "send-audio") {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(command.chunk);
    } else if (command.type === "translate") {
      this.translateTurn(command.turnIndex, command.text);
    } else if (command.type === "batch-translate") {
      this.requestBatchTranslation(command.units);
    } else if (command.type === "translation-degraded") {
      this.translationError = "本地翻译不可用，视频保留原文字幕。";
      this.emitState();
    } else if (command.type === "session-ended") {
      this.stopTickTimer();
      this.emitState({ ended: true, reason: command.reason });
      chrome.runtime.sendMessage({
        type: "video-asr-session-ended",
        sessionId: this.sessionId,
        tabId: this.tabId,
        videoId: this.videoId,
        reason: command.reason,
      }).catch(() => {});
      if (!(this.state.pendingBatch?.length)) this.scheduleCleanup();
    }
  }

  snapshot(extra = {}) {
    return {
      sessionId: this.sessionId,
      tabId: this.tabId,
      videoId: this.videoId,
      status: this.state.status,
      partial: this.state.partial ?? "",
      translationEngine: this.state.translationEngine ?? "builtin",
      sourceLanguage: this.state.sourceLanguage ?? this.sourceLanguage,
      translationDegraded: Boolean(this.state.translationDegraded),
      translationError: this.translationError || this.state.translationError || "",
      pendingBatchCount: this.state.pendingBatch?.length ?? 0,
      records: (this.state.translationRecords ?? []).map((record) => ({ ...record })),
      sessionSeconds: this.state.sessionSeconds ?? 0,
      ...extra,
    };
  }

  emitState(extra) {
    chrome.runtime.sendMessage({
      type: "video-asr-state",
      sessionId: this.sessionId,
      tabId: this.tabId,
      videoId: this.videoId,
      state: this.snapshot(extra),
    }).catch(() => {});
  }

  captureFailed(error) {
    console.error("视频音频捕获失败:", error);
    this.translationError = error?.message || "视频音频捕获失败。";
    this.releaseAudio();
    this.releaseTranslator();
    this.handle({ type: "capture-failed" });
  }

  async startCapture() {
    // AI 批量翻译不需要本地模型；本地引擎则和直播一样先保证模型真的可用，
    // 避免已经开始花 ASR 费用后才发现没有译文能力。
    if (this.state.translationEngine === "builtin") await this.ensureTranslator();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: this.streamId,
        },
      },
      video: false,
    });
    if (this.state.status === "inactive") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.mediaStream = stream;
    const track = stream.getAudioTracks()[0];
    track?.addEventListener("ended", () => this.handle({ type: "audio-track-ended" }));

    // ADR-0001 的双链路不能合并：第一条恢复 tabCapture 静音的原声，第二条
    // 只给 ASR worklet 喂 16kHz PCM，末端用 gain(0) 保证 worklet 被拉取。
    this.playbackContext = new AudioContext();
    if (this.playbackContext.state === "suspended") await this.playbackContext.resume();
    this.playbackContext.createMediaStreamSource(stream).connect(this.playbackContext.destination);

    this.asrContext = new AudioContext({ sampleRate: 16000 });
    if (this.asrContext.state === "suspended") await this.asrContext.resume();
    await this.asrContext.audioWorklet.addModule(chrome.runtime.getURL("dist/asr-worklet.js"));
    if (this.state.status === "inactive") {
      this.releaseAudio();
      return;
    }
    this.asrChunkNode = new AudioWorkletNode(this.asrContext, "asr-chunker");
    this.asrChunkNode.port.onmessage = ({ data }) => {
      this.handle({ type: "audio-chunk", rms: data.rms, chunk: data.chunk });
    };
    const mute = this.asrContext.createGain();
    mute.gain.value = 0;
    this.asrContext.createMediaStreamSource(stream).connect(this.asrChunkNode);
    this.asrChunkNode.connect(mute);
    mute.connect(this.asrContext.destination);
    this.startTickTimer();
    this.emitState();
  }

  releaseAudio() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.asrChunkNode) {
      this.asrChunkNode.port.onmessage = null;
      this.asrChunkNode = null;
    }
    if (this.asrContext) {
      this.asrContext.close().catch(() => {});
      this.asrContext = null;
    }
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }
  }

  stopCapture() {
    this.stopTickTimer();
    this.releaseAudio();
    this.releaseTranslator();
  }

  startTickTimer() {
    if (this.tickTimerId) return;
    this.tickTimerId = setInterval(() => this.handle({ type: "tick", dtSeconds: 1 }), 1000);
  }

  stopTickTimer() {
    if (!this.tickTimerId) return;
    clearInterval(this.tickTimerId);
    this.tickTimerId = null;
  }

  async ensureTranslator() {
    if (this.translator) return this.translator;
    if (!("Translator" in self)) {
      throw new Error("当前浏览器不支持内置翻译。请使用 Chrome 138+ 或 Edge 148+。");
    }
    const pair = { sourceLanguage: this.sourceLanguage, targetLanguage: TARGET_LANGUAGE };
    const availability = await Translator.availability(pair);
    if (availability !== "available") {
      throw new Error("当前语言对的本地翻译模型未就绪。请到设置页下载模型后重试。");
    }
    this.translator = await Translator.create(pair);
    return this.translator;
  }

  releaseTranslator() {
    if (!this.translator) return;
    this.translator.destroy();
    this.translator = null;
  }

  async translateTurn(turnIndex, text) {
    try {
      const translator = await this.ensureTranslator();
      const translation = await translator.translate(text);
      this.handle({ type: "translation-done", turnIndex, text: translation });
    } catch (error) {
      this.translationError = error?.message || "本地翻译失败。";
      this.handle({ type: "translation-failed", error: { message: this.translationError } });
    }
  }

  requestBatchTranslation(units) {
    chrome.runtime.sendMessage({
      type: "video-asr-batch-translation-request",
      sessionId: this.sessionId,
      tabId: this.tabId,
      videoId: this.videoId,
      sourceLanguage: this.sourceLanguage,
      units,
    }).then((result) => {
      if (!result?.ok) {
        this.translationError = result?.error || "AI 批量翻译失败。";
        this.emitState();
        this.scheduleCleanup();
        return;
      }
      this.completeBatchTranslation(result.data?.translations ?? []);
    }).catch((error) => {
      this.translationError = error?.message || "AI 批量翻译失败。";
      this.emitState();
      this.scheduleCleanup();
    });
  }

  scheduleCleanup() {
    if (this.cleanupTimerId) return;
    // content script 已收到完整记录后，offscreen 不必永久保留已结束视频的
    // AudioContext 宿主。给较长字幕的异步批量结果留足时间，之后释放账本。
    this.cleanupTimerId = setTimeout(() => {
      if (videoSessions.get(this.sessionId) === this) videoSessions.delete(this.sessionId);
    }, 10 * 60_000);
  }

  async openSocket() {
    if (!this.apiKey) throw new Error("尚未配置 AssemblyAI Key，请到设置页填写。");
    const response = await fetch(TOKEN_ENDPOINT, { headers: { Authorization: this.apiKey } });
    if (!response.ok) {
      const error = new Error(`换取临时 token 失败（HTTP ${response.status}）`);
      error.authError = response.status === 401 || response.status === 403;
      throw error;
    }
    const { token } = await response.json();
    const params = new URLSearchParams({
      token,
      sample_rate: "16000",
      format_turns: "true",
      speech_model: "universal-3-5-pro",
      language_codes: JSON.stringify([this.sourceLanguage]),
    });
    const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params.toString()}`);
    this.socket = socket;
    if (this.state.status !== "capturing") {
      this.socket = null;
      socket.close();
      return;
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "Begin") {
        this.handle({ type: "socket-open" });
      } else if (message.type === "Turn" && message.transcript) {
        this.handle({
          type: "asr-turn",
          transcript: message.transcript,
          endOfTurn: Boolean(message.end_of_turn),
          formatted: Boolean(message.turn_is_formatted),
        });
      } else if (message.type === "Error") {
        this.handle({
          type: "socket-error",
          error: {
            kind: classifyAsrError(message.error_code),
            code: message.error_code,
            message: message.error,
          },
        });
      } else if (message.type === "Termination") {
        this.handle({ type: "socket-close" });
      }
    };
    socket.onclose = (event) => {
      const wasCurrent = this.socket === socket;
      if (wasCurrent) this.socket = null;
      // 新 socket 已经接管重连时，旧 socket 的 close 不得改变新连接的 reducer。
      if (!wasCurrent && this.socket) return;
      const kind = classifyAsrError(event.code);
      this.handle(kind === "auth"
        ? { type: "socket-error", error: { kind, code: event.code } }
        : { type: "socket-close" });
    };
  }

  closeSocket() {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "Terminate" }));
    }
    socket.close();
  }
}
