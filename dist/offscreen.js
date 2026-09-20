(() => {
  // core/audio.js
  function rmsToVolumePercent(rms) {
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    return Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100)));
  }
  var RENDER_QUANTUM = 128;
  var QUANTA_PER_CHUNK = 8;
  var CHUNK_SAMPLES = RENDER_QUANTUM * QUANTA_PER_CHUNK;
  var CHUNK_MS = 64;

  // core/session.js
  var SESSION_STATUS = {
    INACTIVE: "inactive",
    CAPTURING: "capturing",
    IDLE: "idle",
    RECONNECTING: "reconnecting"
  };
  var ACTIVE_STATUSES = /* @__PURE__ */ new Set([
    SESSION_STATUS.CAPTURING,
    SESSION_STATUS.IDLE,
    SESSION_STATUS.RECONNECTING
  ]);
  var CONNECTION_STATUS = {
    CLOSED: "closed",
    CONNECTING: "connecting",
    OPEN: "open"
  };
  var SUBTITLE_HISTORY = 2;
  var SESSION_CAP_SECONDS = 3600;
  var IDLE_AFTER_MS = 6e4;
  var VOICE_RMS_THRESHOLD = 4e-3;
  var PREBUFFER_MS = 2e3;
  var MAX_RECONNECT_ATTEMPTS = 5;
  var TRANSLATE_TRIGGER = {
    PAUSE: "pause",
    SENTENCE: "sentence"
  };
  var TRANSLATION_ENGINE = {
    BUILTIN: "builtin",
    AI: "ai"
  };
  function resolveTranslationEngine(scene, requestedEngine) {
    return scene === "video" && requestedEngine === TRANSLATION_ENGINE.AI ? TRANSLATION_ENGINE.AI : TRANSLATION_ENGINE.BUILTIN;
  }
  var SENTENCE_BOUNDARY = /[.!?…]+(?=\s+\S)/g;
  var MIN_SENTENCE_WORDS = 2;
  function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }
  function splitStableSentences(text) {
    const sentences = [];
    let start = 0;
    SENTENCE_BOUNDARY.lastIndex = 0;
    let match;
    while ((match = SENTENCE_BOUNDARY.exec(text)) !== null) {
      const end = match.index + match[0].length;
      const candidate = text.slice(start, end).trim();
      if (countWords(candidate) < MIN_SENTENCE_WORDS) continue;
      sentences.push(candidate);
      start = end;
    }
    return { sentences, tail: text.slice(start).trim() };
  }
  var IDLE_AFTER_SILENT_CHUNKS = Math.ceil(IDLE_AFTER_MS / CHUNK_MS);
  var PREBUFFER_CHUNKS = Math.round(PREBUFFER_MS / CHUNK_MS);
  function classifyAsrError(code) {
    if (code === 1008 || code === 3008) return "auth";
    return "network";
  }
  function createSessionState() {
    return { status: SESSION_STATUS.INACTIVE };
  }
  function terminate(state, stopReason, commands) {
    const batchCommands = state.scene === "video" && state.pendingBatch?.length ? [{ type: "batch-translate", units: state.pendingBatch }] : [];
    return {
      state: {
        ...state,
        status: SESSION_STATUS.INACTIVE,
        connection: CONNECTION_STATUS.CLOSED,
        stopReason,
        socketCloseExpected: true
      },
      commands: [...commands, ...batchCommands, { type: "session-ended", reason: stopReason }]
    };
  }
  function scheduleReconnect(state) {
    const attempts = state.reconnectAttempts + 1;
    if (attempts > MAX_RECONNECT_ATTEMPTS) {
      return terminate(state, "reconnect-exhausted", [
        { type: "close-socket" },
        { type: "stop-capture" }
      ]);
    }
    return {
      state: {
        ...state,
        status: SESSION_STATUS.RECONNECTING,
        connection: CONNECTION_STATUS.CLOSED,
        reconnectAttempts: attempts,
        // 指数退避 2^(n-1)：1、2、4、8、16 秒（tick 注入的时间到达后触发）
        retryAtSeconds: state.sessionSeconds + 2 ** (attempts - 1),
        silenceChunks: 0,
        // 同一次断连往往先到 socket-error（Error 帧/连接失败）再到
        // socket-close——置期望标记让随后的 close 被吸收，不重复计数
        socketCloseExpected: true
      },
      commands: []
    };
  }
  function appendTurns(state, sources) {
    let turns = state.turns;
    let turnBaseOffset = state.turnBaseOffset;
    let translationRecords = state.scene === "video" ? state.translationRecords ?? [] : [];
    let pendingBatch = state.pendingBatch ?? [];
    const commands = [];
    for (const source of sources) {
      const turnIndex = turnBaseOffset + turns.length;
      const grown = [...turns, { source, translation: "" }];
      const dropped = Math.max(0, grown.length - SUBTITLE_HISTORY);
      turns = grown.slice(-SUBTITLE_HISTORY);
      turnBaseOffset += dropped;
      const record = {
        turnIndex,
        text: source,
        translation: "",
        translationEngine: state.translationEngine ?? TRANSLATION_ENGINE.BUILTIN
      };
      if (state.scene === "video") translationRecords = [...translationRecords, record];
      if (!state.translationDegraded) {
        if (record.translationEngine === TRANSLATION_ENGINE.AI) {
          pendingBatch = [...pendingBatch, record];
        } else {
          commands.push({ type: "translate", turnIndex, text: source });
        }
      }
    }
    return { next: { turns, turnBaseOffset, translationRecords, pendingBatch }, commands };
  }
  function sessionReducer(state, event) {
    switch (event.type) {
      case "user-start": {
        if (state.status === SESSION_STATUS.INACTIVE) {
          return {
            state: {
              ...state,
              status: SESSION_STATUS.CAPTURING,
              connection: CONNECTION_STATUS.CONNECTING,
              chunkCount: 0,
              partial: "",
              turns: [],
              turnBaseOffset: 0,
              // 触发模式随本次会话固定（设置页改动下次开始才生效）
              translateTrigger: event.translateTrigger ?? TRANSLATE_TRIGGER.PAUSE,
              // 源语言同样随会话固定。它是浏览器宿主选择 AssemblyAI 参数和
              // Translator 语言对的共同输入，reducer 本身不按语言分叉。
              sourceLanguage: event.sourceLanguage ?? null,
              scene: event.scene === "video" ? "video" : "live",
              translationEngine: resolveTranslationEngine(event.scene, event.translationEngine),
              emittedSentences: 0,
              sessionSeconds: 0,
              stopReason: null,
              silenceChunks: 0,
              prebuffer: [],
              reconnectAttempts: 0,
              retryAtSeconds: null,
              socketCloseExpected: false,
              translationDegraded: false,
              translationError: null,
              translationRecords: [],
              pendingBatch: []
            },
            commands: [
              { type: "start-capture", streamId: event.streamId },
              { type: "open-socket", reason: "initial" }
            ]
          };
        }
        return { state, commands: [] };
      }
      case "audio-chunk": {
        if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
        const voiced = event.rms >= VOICE_RMS_THRESHOLD;
        const prebuffer = [...state.prebuffer ?? [], event.chunk];
        if (prebuffer.length > PREBUFFER_CHUNKS) {
          prebuffer.splice(0, prebuffer.length - PREBUFFER_CHUNKS);
        }
        if (state.status === SESSION_STATUS.IDLE) {
          if (!voiced) {
            return { state: { ...state, prebuffer, chunkCount: state.chunkCount + 1 }, commands: [] };
          }
          return {
            state: {
              ...state,
              prebuffer,
              chunkCount: state.chunkCount + 1,
              status: SESSION_STATUS.CAPTURING,
              connection: CONNECTION_STATUS.CONNECTING
            },
            commands: [{ type: "open-socket", reason: "voice-resumed" }]
          };
        }
        if (state.status === SESSION_STATUS.CAPTURING && state.connection === CONNECTION_STATUS.OPEN) {
          const silenceChunks = voiced ? 0 : (state.silenceChunks ?? 0) + 1;
          if (silenceChunks >= IDLE_AFTER_SILENT_CHUNKS) {
            return {
              state: {
                ...state,
                prebuffer,
                chunkCount: state.chunkCount + 1,
                silenceChunks: 0,
                status: SESSION_STATUS.IDLE,
                connection: CONNECTION_STATUS.CLOSED,
                socketCloseExpected: true
              },
              commands: [{ type: "close-socket", reason: "idle" }]
            };
          }
          return {
            state: { ...state, prebuffer, silenceChunks, chunkCount: state.chunkCount + 1 },
            commands: [{ type: "send-audio", chunk: event.chunk }]
          };
        }
        return {
          state: { ...state, prebuffer, chunkCount: state.chunkCount + 1 },
          commands: []
        };
      }
      case "socket-open": {
        if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
        const flush = (state.prebuffer ?? []).map((chunk) => ({
          type: "send-audio",
          chunk
        }));
        return {
          state: {
            ...state,
            status: SESSION_STATUS.CAPTURING,
            connection: CONNECTION_STATUS.OPEN,
            prebuffer: [],
            reconnectAttempts: 0,
            retryAtSeconds: null
          },
          commands: flush
        };
      }
      case "socket-close": {
        if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
        if (state.socketCloseExpected) {
          return {
            state: { ...state, connection: CONNECTION_STATUS.CLOSED, socketCloseExpected: false },
            commands: []
          };
        }
        return scheduleReconnect(state);
      }
      case "socket-error": {
        if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
        if (event.error?.kind === "auth") {
          return terminate(state, "auth-error", [
            { type: "close-socket" },
            { type: "stop-capture" }
          ]);
        }
        return scheduleReconnect(state);
      }
      case "asr-turn": {
        if (state.status !== SESSION_STATUS.CAPTURING) return { state, commands: [] };
        const endOfTurn = Boolean(event.endOfTurn && event.formatted);
        if (state.translateTrigger === TRANSLATE_TRIGGER.SENTENCE) {
          const { sentences, tail } = splitStableSentences(event.transcript);
          const pending = sentences.slice(state.emittedSentences ?? 0);
          if (endOfTurn && tail) pending.push(tail);
          const appended = appendTurns(state, pending);
          return {
            state: {
              ...state,
              ...appended.next,
              // 已定稿的句子从 partial 里剪掉，只留还在写的尾巴——否则同一
              // 句西语会同时出现在定稿行和滚动行
              partial: endOfTurn ? "" : tail,
              emittedSentences: endOfTurn ? 0 : sentences.length
            },
            commands: appended.commands
          };
        }
        if (endOfTurn) {
          const appended = appendTurns(state, [event.transcript]);
          return {
            state: { ...state, ...appended.next, partial: "" },
            commands: appended.commands
          };
        }
        return {
          state: { ...state, partial: event.transcript },
          commands: []
        };
      }
      case "translation-done": {
        const records = (state.translationRecords ?? []).map(
          (record) => record.turnIndex === event.turnIndex ? { ...record, translation: event.text } : record
        );
        const recordMatched = records.some((record) => record.turnIndex === event.turnIndex);
        const windowIndex = event.turnIndex - state.turnBaseOffset;
        const turns = state.turns?.slice() ?? [];
        const turnMatched = Number.isInteger(windowIndex) && windowIndex >= 0 && windowIndex < turns.length;
        if (turnMatched) {
          turns[windowIndex] = { ...turns[windowIndex], translation: event.text };
        }
        return recordMatched || turnMatched ? { state: { ...state, turns, translationRecords: records }, commands: [] } : { state, commands: [] };
      }
      case "batch-translation-done": {
        const translations = new Map(
          (event.translations ?? []).map(({ turnIndex, text }) => [turnIndex, text])
        );
        if (translations.size === 0) return { state, commands: [] };
        const translationRecords = (state.translationRecords ?? []).map(
          (record) => translations.has(record.turnIndex) ? { ...record, translation: translations.get(record.turnIndex) } : record
        );
        const turns = (state.turns ?? []).map((turn, index) => {
          const turnIndex = (state.turnBaseOffset ?? 0) + index;
          return translations.has(turnIndex) ? { ...turn, translation: translations.get(turnIndex) } : turn;
        });
        const pendingBatch = (state.pendingBatch ?? []).filter(
          (unit) => !translations.has(unit.turnIndex)
        );
        return { state: { ...state, turns, translationRecords, pendingBatch }, commands: [] };
      }
      case "set-translation-engine": {
        if (ACTIVE_STATUSES.has(state.status) && state.scene === "video") {
          return {
            state: {
              ...state,
              translationEngine: resolveTranslationEngine("video", event.translationEngine),
              translationError: null
            },
            commands: []
          };
        }
        return { state, commands: [] };
      }
      case "translation-failed": {
        if (ACTIVE_STATUSES.has(state.status) && state.scene === "video") {
          return {
            state: { ...state, translationError: event.error?.message ?? "\u672C\u5730\u7FFB\u8BD1\u5931\u8D25\u3002" },
            commands: []
          };
        }
        if (ACTIVE_STATUSES.has(state.status) && !state.translationDegraded) {
          return {
            state: { ...state, translationDegraded: true },
            commands: [{ type: "translation-degraded" }]
          };
        }
        return { state, commands: [] };
      }
      case "user-stop": {
        if (ACTIVE_STATUSES.has(state.status)) {
          return terminate(state, "user-stop", [
            { type: "close-socket" },
            { type: "stop-capture" }
          ]);
        }
        return { state, commands: [] };
      }
      case "capture-failed": {
        if (state.status === SESSION_STATUS.CAPTURING) {
          const wasConnected = state.connection !== CONNECTION_STATUS.CLOSED;
          return terminate(
            state,
            "capture-failed",
            wasConnected ? [{ type: "close-socket" }] : []
          );
        }
        return { state, commands: [] };
      }
      // 音频轨结束：用户关掉了被捕获的标签页，或直播本身断流。
      // 继续为一个不存在的标签页付费是纯粹浪费（ADR-0005），完整停止。
      case "audio-track-ended": {
        if (ACTIVE_STATUSES.has(state.status)) {
          return terminate(state, "audio-ended", [
            { type: "close-socket" },
            { type: "stop-capture" }
          ]);
        }
        return { state, commands: [] };
      }
      case "video-playthrough-complete": {
        if (ACTIVE_STATUSES.has(state.status) && state.scene === "video") {
          return terminate(state, "video-playthrough", [
            { type: "close-socket" },
            { type: "stop-capture" }
          ]);
        }
        return { state, commands: [] };
      }
      case "tick": {
        if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
        const sessionSeconds = state.sessionSeconds + (event.dtSeconds ?? 0);
        if (sessionSeconds >= SESSION_CAP_SECONDS) {
          return terminate(state, "session-cap", [
            { type: "close-socket" },
            { type: "stop-capture" }
          ]);
        }
        if (state.status === SESSION_STATUS.RECONNECTING && state.retryAtSeconds !== null && sessionSeconds >= state.retryAtSeconds) {
          return {
            state: {
              ...state,
              sessionSeconds,
              status: SESSION_STATUS.CAPTURING,
              connection: CONNECTION_STATUS.CONNECTING,
              retryAtSeconds: null
            },
            commands: [{ type: "open-socket", reason: "retry" }]
          };
        }
        return { state: { ...state, sessionSeconds }, commands: [] };
      }
      default:
        return { state, commands: [] };
    }
  }

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
  var DEFAULT_SOURCE_LANGUAGE = "es";
  var DEFAULT_TARGET_LANGUAGE = "zh";
  var TARGET_LANGUAGE = DEFAULT_TARGET_LANGUAGE;

  // offscreen.js
  var TOKEN_ENDPOINT = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=${SESSION_CAP_SECONDS}`;
  var playbackContext;
  var asrContext;
  var mediaStream;
  var asrChunkNode;
  var asrSocket;
  var tickTimerId = null;
  var apiKey;
  var sourceLanguage = DEFAULT_SOURCE_LANGUAGE;
  var translator;
  var sessionState = createSessionState();
  var videoSessions = /* @__PURE__ */ new Map();
  function dispatch(event) {
    const result = sessionReducer(sessionState, event);
    const prevPhase = sessionState.status;
    sessionState = result.state;
    if (sessionState.status !== prevPhase) {
      if (sessionState.status === "reconnecting") {
        reportStatus(
          `\u{1F504} \u8FDE\u63A5\u4E2D\u65AD\uFF0C\u81EA\u52A8\u91CD\u8FDE\u4E2D\uFF08\u5DF2\u91CD\u8BD5 ${sessionState.reconnectAttempts} \u6B21\uFF0C\u6700\u591A 5 \u6B21\uFF09\u2026`
        );
      }
      reportTranscript();
    }
    return result.commands;
  }
  function executeCommand(command) {
    if (command.type === "start-capture") {
      startCapture(command.streamId).catch((err) => {
        console.error("\u97F3\u9891\u6355\u83B7\u5931\u8D25:", err);
        releaseAudio();
        releaseTranslator();
        handle({ type: "capture-failed" });
        if (!err.blocked) {
          reportStatus(`\u274C \u6355\u83B7\u5931\u8D25: ${err.message}`);
        }
      });
    } else if (command.type === "stop-capture") {
      stopCapture();
    } else if (command.type === "session-ended") {
      stopTickTimer();
      reportStatus(sessionEndMessages[command.reason] ?? "\u23F9 \u4F1A\u8BDD\u5DF2\u7ED3\u675F\u3002");
      chrome.runtime.sendMessage({ type: "session-ended", reason: command.reason }).catch(() => {
      });
    } else if (command.type === "open-socket") {
      const attempt = sessionState.reconnectAttempts;
      if (command.reason === "voice-resumed") {
        reportStatus("\u{1F3A4} \u68C0\u6D4B\u5230\u8BED\u97F3\uFF0C\u6062\u590D\u8F6C\u5199\u8FDE\u63A5\u2026");
      } else if (command.reason === "retry") {
        reportStatus(`\u{1F504} \u7F51\u7EDC\u91CD\u8FDE\u4E2D\uFF08\u7B2C ${attempt} \u6B21\uFF09\u2026`);
      }
      openAsrSocket().catch((err) => {
        console.error("\u8F6C\u5199\u8FDE\u63A5\u5EFA\u7ACB\u5931\u8D25:", err);
        handle({
          type: "socket-error",
          error: { kind: err.authError ? "auth" : "network", message: err.message }
        });
      });
    } else if (command.type === "translate") {
      translateTurn(command.turnIndex, command.text);
    } else if (command.type === "close-socket") {
      if (command.reason === "idle") {
        reportStatus("\u{1F4A4} \u5F85\u673A\u4E2D\uFF1A\u8FDE\u7EED 60 \u79D2\u672A\u68C0\u6D4B\u5230\u8BED\u97F3\uFF0C\u5DF2\u6682\u505C\u4E0A\u4F20\uFF08\u4E0D\u518D\u8BA1\u8D39\uFF09\u3002\u6709\u58F0\u97F3\u4F1A\u81EA\u52A8\u6062\u590D\u3002");
      }
      closeAsrSocket();
    } else if (command.type === "translation-degraded") {
      reportStatus("\u26A0\uFE0F \u7FFB\u8BD1\u4E0D\u53EF\u7528\uFF0C\u5B57\u5E55\u5DF2\u964D\u7EA7\u4E3A\u4EC5\u897F\u8BED\u3002\u897F\u8BED\u8F6C\u5199\u4E0D\u53D7\u5F71\u54CD\u3002");
      reportTranscript();
    } else if (command.type === "send-audio") {
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
      sendResponse(sessionState);
      return;
    }
    if (message.type === "get-capture-status") {
      const activeStatuses = /* @__PURE__ */ new Set(["capturing", "idle", "reconnecting"]);
      sendResponse({
        liveStatus: sessionState.status,
        videoActive: [...videoSessions.values()].some(
          (session) => activeStatuses.has(session.state.status)
        )
      });
      return;
    }
    if (message.type === "start-capture") {
      apiKey = message.apiKey;
      const startingFreshSession = sessionState.status === "inactive";
      if (startingFreshSession) sourceLanguage = message.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
      const commands = handle({
        type: "user-start",
        streamId: message.streamId,
        translateTrigger: message.translateTrigger,
        sourceLanguage: message.sourceLanguage
      });
      if (startingFreshSession) sourceLanguage = sessionState.sourceLanguage;
      if (commands.length === 0) {
        reportStatus("\u2139\uFE0F \u5DF2\u7ECF\u5728\u6355\u83B7\u4E2D\uFF0C\u5FFD\u7565\u91CD\u590D\u8BF7\u6C42");
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
      translateVideoUnits(message.units, message.sourceLanguage).then((translations) => sendResponse({ ok: true, data: { translations } })).catch((error) => sendResponse({ ok: false, error: error.message || "\u672C\u5730\u7FFB\u8BD1\u5931\u8D25\u3002" }));
      return true;
    }
  });
  function reportStatus(status) {
    chrome.runtime.sendMessage({ type: "capture-status", status });
  }
  async function startCapture(streamId) {
    const ready = await ensureTranslatorReady();
    if (!ready) {
      const err = new Error("\u7FFB\u8BD1\u6A21\u578B\u672A\u5C31\u7EEA");
      err.blocked = true;
      throw err;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
    const track = mediaStream.getAudioTracks()[0];
    console.log("[EchoSage] audio track:", track && {
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState
    });
    track.addEventListener("mute", () => console.log("[EchoSage] \u26A0\uFE0F track \u4E8B\u4EF6: mute\uFF08\u6D41\u53D8\u9759\u97F3\uFF09"));
    track.addEventListener("unmute", () => console.log("[EchoSage] track \u4E8B\u4EF6: unmute"));
    track.addEventListener("ended", () => {
      console.log("[EchoSage] track \u4E8B\u4EF6: ended\uFF08\u6D41\u5DF2\u7ED3\u675F\uFF09");
      handle({ type: "audio-track-ended" });
    });
    playbackContext = new AudioContext();
    if (playbackContext.state === "suspended") {
      await playbackContext.resume();
    }
    playbackContext.createMediaStreamSource(mediaStream).connect(playbackContext.destination);
    asrContext = new AudioContext({ sampleRate: 16e3 });
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
      if (sessionState.status === "capturing") {
        const volumePercent = rmsToVolumePercent(rms);
        reportStatus(
          `\u{1F50A} \u97F3\u91CF: ${"\u2588".repeat(Math.round(volumePercent / 5))} ${volumePercent}%\uFF5C\u5DF2\u4EA7\u51FA\u97F3\u9891\u5757 #${sessionState.chunkCount}`
        );
      }
    };
    const mute = asrContext.createGain();
    mute.gain.value = 0;
    asrContext.createMediaStreamSource(mediaStream).connect(asrChunkNode);
    asrChunkNode.connect(mute);
    mute.connect(asrContext.destination);
    startTickTimer();
    reportStatus("\u2705 \u5DF2\u5F00\u59CB\u6355\u83B7\uFF08\u56DE\u653E + \u8F6C\u5199\u53CC\u94FE\u8DEF\uFF09\uFF0C\u5B9E\u65F6\u97F3\u91CF\u5982\u4E0B\uFF1A");
  }
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
  function startTickTimer() {
    tickTimerId = setInterval(() => {
      handle({ type: "tick", dtSeconds: 1 });
      reportSessionTime();
    }, 1e3);
  }
  function stopTickTimer() {
    if (tickTimerId) {
      clearInterval(tickTimerId);
      tickTimerId = null;
    }
  }
  function reportSessionTime() {
    chrome.runtime.sendMessage({
      type: "session-time",
      seconds: sessionState.sessionSeconds
    }).catch(() => {
    });
  }
  function languagePair() {
    return { sourceLanguage, targetLanguage: TARGET_LANGUAGE };
  }
  async function ensureTranslatorReady() {
    if (!("Translator" in self)) {
      reportBlocked("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5185\u7F6E\u7FFB\u8BD1\uFF0C\u65E0\u6CD5\u505A\u4E2D\u6587\u7FFB\u8BD1\u3002\u53EF\u7528\uFF1AChrome 138+ / Edge 148+\u3002");
      return false;
    }
    const pair = languagePair();
    const availability = await Translator.availability(pair);
    if (availability !== "available") {
      reportBlocked(
        `\u7FFB\u8BD1\u6A21\u578B\u672A\u5C31\u7EEA\uFF08\u53EF\u80FD\u672A\u4E0B\u8F7D\u6216\u88AB\u6E05\u7406\uFF09\u3002\u8BF7\u5230\u6269\u5C55\u8BBE\u7F6E\u9875\u4E0B\u8F7D\u5F53\u524D\u8BED\u8A00\u5BF9\uFF08${sourceLanguage}\u2192${TARGET_LANGUAGE}\uFF09\u540E\u518D\u5F00\u59CB\u3002`
      );
      return false;
    }
    try {
      translator = await Translator.create(pair);
      return true;
    } catch (err) {
      console.error("\u521B\u5EFA\u7FFB\u8BD1\u5668\u5931\u8D25:", err);
      reportBlocked(`\u521B\u5EFA\u7FFB\u8BD1\u5668\u5931\u8D25\uFF1A${err.name}: ${err.message}\u3002\u53EF\u5C1D\u8BD5\u91CD\u542F\u6D4F\u89C8\u5668\u6216\u5230\u8BBE\u7F6E\u9875\u91CD\u65B0\u4E0B\u8F7D\u6A21\u578B\u3002`);
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
      throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5185\u7F6E\u7FFB\u8BD1\u3002\u8BF7\u4F7F\u7528 Chrome 138+ \u6216 Edge 148+\u3002");
    }
    const pair = {
      sourceLanguage: requestedSourceLanguage || DEFAULT_SOURCE_LANGUAGE,
      targetLanguage: TARGET_LANGUAGE
    };
    const availability = await Translator.availability(pair);
    if (availability !== "available") {
      throw new Error("\u5F53\u524D\u8BED\u8A00\u5BF9\u7684\u672C\u5730\u7FFB\u8BD1\u6A21\u578B\u672A\u5C31\u7EEA\u3002\u8BF7\u5230\u8BBE\u7F6E\u9875\u4E0B\u8F7D\u6A21\u578B\u540E\u91CD\u8BD5\u3002");
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
          text: text ? await videoTranslator.translate(text) : ""
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
      console.error("\u7FFB\u8BD1\u5931\u8D25:", err);
      handle({ type: "translation-failed" });
      reportTranscript();
    }
  }
  function reportBlocked(message) {
    chrome.runtime.sendMessage({ type: "capture-blocked", reason: "translator-unavailable", message }).catch(() => {
    });
  }
  async function openAsrSocket() {
    if (!apiKey) {
      throw new Error("\u5C1A\u672A\u914D\u7F6E AssemblyAI Key\uFF0C\u8BF7\u5230\u8BBE\u7F6E\u9875\u586B\u5199");
    }
    const response = await fetch(TOKEN_ENDPOINT, {
      headers: { Authorization: apiKey }
    });
    if (!response.ok) {
      const err = new Error(`\u6362\u53D6\u4E34\u65F6 token \u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
      if (response.status === 401 || response.status === 403) {
        err.authError = true;
      }
      throw err;
    }
    const { token } = await response.json();
    const params = new URLSearchParams({
      token,
      sample_rate: "16000",
      format_turns: "true",
      speech_model: "universal-3-5-pro",
      language_codes: JSON.stringify([sourceLanguage])
    });
    const socket = new WebSocket(
      `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`
    );
    asrSocket = socket;
    if (sessionState.status !== "capturing") {
      asrSocket = null;
      socket.close();
      return;
    }
    socket.onopen = () => {
      reportStatus("\u{1F517} \u8F6C\u5199\u8FDE\u63A5\u5DF2\u5EFA\u7ACB");
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
          formatted: Boolean(msg.turn_is_formatted)
        });
        reportTranscript();
      } else if (msg.type === "Error") {
        const kind = classifyAsrError(msg.error_code);
        handle({ type: "socket-error", error: { kind, code: msg.error_code, message: msg.error } });
        if (kind === "auth") {
          console.error("[EchoSage] \u8F6C\u5199\u670D\u52A1\u62A5\u9519\uFF08\u7EC8\u6B62\u7C7B\uFF09:", msg.error_code, msg.error);
        }
      } else if (msg.type === "Termination") {
        handle({ type: "socket-close" });
      }
    };
    socket.onclose = (event) => {
      if (asrSocket === socket) asrSocket = null;
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
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "Terminate" }));
    }
    socket.close();
  }
  function reportTranscript() {
    const state = {
      subtitle: sessionState.turns,
      partial: sessionState.partial,
      phase: sessionState.status,
      translationDegraded: sessionState.translationDegraded
    };
    chrome.runtime.sendMessage({ type: "subtitle-relay", state }).catch(() => {
    });
    chrome.runtime.sendMessage({
      type: "transcript-update",
      partial: sessionState.partial,
      turns: sessionState.turns
    }).catch(() => {
    });
  }
  var VideoCaptureSession = class {
    constructor({
      sessionId,
      tabId,
      videoId,
      streamId,
      apiKey: sessionApiKey,
      sourceLanguage: requestedSourceLanguage,
      translateTrigger,
      translationEngine
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
        translationEngine: this.translationEngine
      });
    }
    stop(reason = "user-stop") {
      this.handle({
        type: reason === "video-playthrough" ? "video-playthrough-complete" : "user-stop"
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
          console.error("\u89C6\u9891\u8F6C\u5199\u8FDE\u63A5\u5EFA\u7ACB\u5931\u8D25:", error);
          this.handle({
            type: "socket-error",
            error: { kind: error.authError ? "auth" : "network", message: error.message }
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
        this.translationError = "\u672C\u5730\u7FFB\u8BD1\u4E0D\u53EF\u7528\uFF0C\u89C6\u9891\u4FDD\u7559\u539F\u6587\u5B57\u5E55\u3002";
        this.emitState();
      } else if (command.type === "session-ended") {
        this.stopTickTimer();
        this.emitState({ ended: true, reason: command.reason });
        chrome.runtime.sendMessage({
          type: "video-asr-session-ended",
          sessionId: this.sessionId,
          tabId: this.tabId,
          videoId: this.videoId,
          reason: command.reason
        }).catch(() => {
        });
        if (!this.state.pendingBatch?.length) this.scheduleCleanup();
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
        ...extra
      };
    }
    emitState(extra) {
      chrome.runtime.sendMessage({
        type: "video-asr-state",
        sessionId: this.sessionId,
        tabId: this.tabId,
        videoId: this.videoId,
        state: this.snapshot(extra)
      }).catch(() => {
      });
    }
    captureFailed(error) {
      console.error("\u89C6\u9891\u97F3\u9891\u6355\u83B7\u5931\u8D25:", error);
      this.translationError = error?.message || "\u89C6\u9891\u97F3\u9891\u6355\u83B7\u5931\u8D25\u3002";
      this.releaseAudio();
      this.releaseTranslator();
      this.handle({ type: "capture-failed" });
    }
    async startCapture() {
      if (this.state.translationEngine === "builtin") await this.ensureTranslator();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: this.streamId
          }
        },
        video: false
      });
      if (this.state.status === "inactive") {
        stream.getTracks().forEach((track2) => track2.stop());
        return;
      }
      this.mediaStream = stream;
      const track = stream.getAudioTracks()[0];
      track?.addEventListener("ended", () => this.handle({ type: "audio-track-ended" }));
      this.playbackContext = new AudioContext();
      if (this.playbackContext.state === "suspended") await this.playbackContext.resume();
      this.playbackContext.createMediaStreamSource(stream).connect(this.playbackContext.destination);
      this.asrContext = new AudioContext({ sampleRate: 16e3 });
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
        this.asrContext.close().catch(() => {
        });
        this.asrContext = null;
      }
      if (this.playbackContext) {
        this.playbackContext.close().catch(() => {
        });
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
      this.tickTimerId = setInterval(() => this.handle({ type: "tick", dtSeconds: 1 }), 1e3);
    }
    stopTickTimer() {
      if (!this.tickTimerId) return;
      clearInterval(this.tickTimerId);
      this.tickTimerId = null;
    }
    async ensureTranslator() {
      if (this.translator) return this.translator;
      if (!("Translator" in self)) {
        throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5185\u7F6E\u7FFB\u8BD1\u3002\u8BF7\u4F7F\u7528 Chrome 138+ \u6216 Edge 148+\u3002");
      }
      const pair = { sourceLanguage: this.sourceLanguage, targetLanguage: TARGET_LANGUAGE };
      const availability = await Translator.availability(pair);
      if (availability !== "available") {
        throw new Error("\u5F53\u524D\u8BED\u8A00\u5BF9\u7684\u672C\u5730\u7FFB\u8BD1\u6A21\u578B\u672A\u5C31\u7EEA\u3002\u8BF7\u5230\u8BBE\u7F6E\u9875\u4E0B\u8F7D\u6A21\u578B\u540E\u91CD\u8BD5\u3002");
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
        const translator2 = await this.ensureTranslator();
        const translation = await translator2.translate(text);
        this.handle({ type: "translation-done", turnIndex, text: translation });
      } catch (error) {
        this.translationError = error?.message || "\u672C\u5730\u7FFB\u8BD1\u5931\u8D25\u3002";
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
        units
      }).then((result) => {
        if (!result?.ok) {
          this.translationError = result?.error || "AI \u6279\u91CF\u7FFB\u8BD1\u5931\u8D25\u3002";
          this.emitState();
          this.scheduleCleanup();
          return;
        }
        this.completeBatchTranslation(result.data?.translations ?? []);
      }).catch((error) => {
        this.translationError = error?.message || "AI \u6279\u91CF\u7FFB\u8BD1\u5931\u8D25\u3002";
        this.emitState();
        this.scheduleCleanup();
      });
    }
    scheduleCleanup() {
      if (this.cleanupTimerId) return;
      this.cleanupTimerId = setTimeout(() => {
        if (videoSessions.get(this.sessionId) === this) videoSessions.delete(this.sessionId);
      }, 10 * 6e4);
    }
    async openSocket() {
      if (!this.apiKey) throw new Error("\u5C1A\u672A\u914D\u7F6E AssemblyAI Key\uFF0C\u8BF7\u5230\u8BBE\u7F6E\u9875\u586B\u5199\u3002");
      const response = await fetch(TOKEN_ENDPOINT, { headers: { Authorization: this.apiKey } });
      if (!response.ok) {
        const error = new Error(`\u6362\u53D6\u4E34\u65F6 token \u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
        error.authError = response.status === 401 || response.status === 403;
        throw error;
      }
      const { token } = await response.json();
      const params = new URLSearchParams({
        token,
        sample_rate: "16000",
        format_turns: "true",
        speech_model: "universal-3-5-pro",
        language_codes: JSON.stringify([this.sourceLanguage])
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
            formatted: Boolean(message.turn_is_formatted)
          });
        } else if (message.type === "Error") {
          this.handle({
            type: "socket-error",
            error: {
              kind: classifyAsrError(message.error_code),
              code: message.error_code,
              message: message.error
            }
          });
        } else if (message.type === "Termination") {
          this.handle({ type: "socket-close" });
        }
      };
      socket.onclose = (event) => {
        const wasCurrent = this.socket === socket;
        if (wasCurrent) this.socket = null;
        if (!wasCurrent && this.socket) return;
        const kind = classifyAsrError(event.code);
        this.handle(kind === "auth" ? { type: "socket-error", error: { kind, code: event.code } } : { type: "socket-close" });
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
  };
})();
