// 核心模块 —— 会话 reducer（纯逻辑，不接触任何浏览器 API）
//
// reducer 接收事件、返回下一状态与待执行指令，自身不执行任何副作用。
// 时间由外部以 tick 事件注入，不读系统时钟——为了让「连续静音 60 秒」
// 这类行为能被瞬间断言，而不需要真的等 60 秒。
//
// 宿主（offscreen）负责：把浏览器事件翻译成这里的 reducer 事件，
// 把返回的指令翻译成实际副作用。重复开始的保护由状态转移承担：
// user-start 在 inactive 时同步转移到 capturing，宿主在消息送达的同步调用栈
// 里跑完这步转移，第二个挨得再近的 start 请求也会被挡住——这取代了
// 原来「在 await 之前置位的同步锁」，行为不能退化。

import { CHUNK_MS } from "./audio.js";

// 状态名遵循 ADR-0005 的保留约定：
//   inactive      未在捕获
//   capturing     捕获中（连接可能是 connecting/open/closed 子状态）
//   idle          静音断开中——音频仍在采集，socket 已主动关闭，等待语音
//   reconnecting  意外断连后的指数退避等待中
export const SESSION_STATUS = {
  INACTIVE: "inactive",
  CAPTURING: "capturing",
  IDLE: "idle",
  RECONNECTING: "reconnecting",
};

const ACTIVE_STATUSES = new Set([
  SESSION_STATUS.CAPTURING,
  SESSION_STATUS.IDLE,
  SESSION_STATUS.RECONNECTING,
]);

export const CONNECTION_STATUS = {
  CLOSED: "closed",
  CONNECTING: "connecting",
  OPEN: "open",
};

// 屏幕上保留的定稿话轮条数（读到一半被顶掉时还能补读，ADR-0002）
export const SUBTITLE_HISTORY = 2;

// 单次会话时长硬上限（秒）。与换 token 时的
// max_session_duration_seconds=3600 对齐：服务端到限强制收尾，客户端在
// 同一刻主动结束并给出提示（ADR-0005 花钱保险丝）。
export const SESSION_CAP_SECONDS = 3600;

// 连续静音多久转入 idle（毫秒）。60 秒而不是更激进：自然停顿只有 1–3 秒，
// 每个停顿都断开省不到钱，反而因为重连握手吃掉每句话开头的几个字
// （ADR-0005）。静音按音频块计时（每块 CHUNK_MS），不依赖 tick。
export const IDLE_AFTER_MS = 60_000;

// RMS 达到多少算「检测到语音」。这是「断连灵敏度」的调节旋钮：
// 调高 → 更容易判静音、更快断连省钱，但可能把低音量人声当成静音。
export const VOICE_RMS_THRESHOLD = 0.004;

// 重连预缓冲长度（毫秒）。重连的 token+握手约 1 秒，2 秒缓冲把重新开口
// 的头几个字接住（ADR-0005）。环形：满则丢最旧的。
export const PREBUFFER_MS = 2000;

// 网络类错误的最大重连次数。指数退避 1+2+4+8+16≈31 秒，扛过多数抖动；
// 上限保证即使错误被漏判也不会无限循环——每次重连都是新会话、都计费。
export const MAX_RECONNECT_ATTEMPTS = 5;

// 译文触发时机（设置项，随 user-start 进入会话，中途不变）。
//   pause    话轮结束才翻译——ADR-0002 的原始设计，延迟由主播的停顿决定
//   sentence 句子说完就翻译——主播连讲不停时把延迟从「等静音」压到「等一帧」
export const TRANSLATE_TRIGGER = {
  PAUSE: "pause",
  SENTENCE: "sentence",
};

// 翻译引擎是独立于译文触发时机的第二条轴。直播实时固定内置引擎；只有
// 视频字幕场景可以选择 AI 整段批量翻译。
export const TRANSLATION_ENGINE = {
  BUILTIN: "builtin",
  AI: "ai",
};

function resolveTranslationEngine(scene, requestedEngine) {
  return scene === "video" && requestedEngine === TRANSLATION_ENGINE.AI
    ? TRANSLATION_ENGINE.AI
    : TRANSLATION_ENGINE.BUILTIN;
}

// 一个句末边界必须满足：终止符后面**已经有新文字**（`\s+\S`）。
// 这不是为了好看——实测 partial 末尾的句号是临时的，AssemblyAI 会在下
// 一帧把它改写掉（`...viene en la mayoría.` → `...viene en la mayoría de
// las cajoneras.`，`...en la de 12.` → `...en la de 12,`）。按末尾句号
// 翻译会产出无法收回的错译，而字幕不允许自我改写（ADR-0002）。
// 一旦句号后面长出了字，它就再也不会变。
const SENTENCE_BOUNDARY = /[.!?…]+(?=\s+\S)/g;

// 短于这个词数的片段不单独成句，并入下一句。挡住 ASR 偶发的 `y.` `eh.`
// 这类碎片——它们会占掉一整行字幕并浪费一次翻译调用。代价是 `Sí.`
// 这类真短句也要等下一句才出。
const MIN_SENTENCE_WORDS = 2;

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// 把转写文本切成「已稳定的整句」+「还在写的尾巴」。纯函数，导出供测试。
export function splitStableSentences(text) {
  const sentences = [];
  let start = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match;
  while ((match = SENTENCE_BOUNDARY.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const candidate = text.slice(start, end).trim();
    // 词数不足：不定稿，把 start 留在原处，让它和下一句合并
    if (countWords(candidate) < MIN_SENTENCE_WORDS) continue;
    sentences.push(candidate);
    start = end;
  }
  return { sentences, tail: text.slice(start).trim() };
}

const IDLE_AFTER_SILENT_CHUNKS = Math.ceil(IDLE_AFTER_MS / CHUNK_MS);
const PREBUFFER_CHUNKS = Math.round(PREBUFFER_MS / CHUNK_MS);

// AssemblyAI v3 关闭码分类。
//   auth 类（立即终止，绝不重连）：
//     1008 鉴权失败/余额耗尽/账号停用——重连注定失败且反复计费
//     3008 会话到限——重连=绕过「到限要重新点开始」的故意摩擦（ADR-0005）
//   其余（1006 网络断开、3005 服务端错误、3006 不活跃/无效消息、
//   3007 音频速率、3009 并发上限、1011 服务端错误）归网络类：
//   有界退避重试，漏判由次数上限兜底。
export function classifyAsrError(code) {
  if (code === 1008 || code === 3008) return "auth";
  return "network";
}

export function createSessionState() {
  return { status: SESSION_STATUS.INACTIVE };
}

// 所有终止路径共用的转移：inactive 化 + 终止指令 + 终止原因。
// session-ended 指令让宿主统一收尾（停计时器、播报、通知浮层），
// 宿主不需要知道每条终止路径的细节；stopReason 留在状态里供查询。
function terminate(state, stopReason, commands) {
  // AI 引擎只在视频场景可用，并且必须等转写终止后把累积单位作为一批交给
  // 宿主。内置引擎不会走这里，因此直播实时不会意外触发云端请求。
  const batchCommands = state.scene === "video" && state.pendingBatch?.length
    ? [{ type: "batch-translate", units: state.pendingBatch }]
    : [];
  return {
    state: {
      ...state,
      status: SESSION_STATUS.INACTIVE,
      connection: CONNECTION_STATUS.CLOSED,
      stopReason,
      socketCloseExpected: true,
    },
    commands: [...commands, ...batchCommands, { type: "session-ended", reason: stopReason }],
  };
}

// 网络类错误/意外断连共用的退避转移
function scheduleReconnect(state) {
  const attempts = state.reconnectAttempts + 1;
  if (attempts > MAX_RECONNECT_ATTEMPTS) {
    return terminate(state, "reconnect-exhausted", [
      { type: "close-socket" },
      { type: "stop-capture" },
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
      socketCloseExpected: true,
    },
    commands: [],
  };
}

// 把若干条定稿字幕行追加进窗口，并为每条产出翻译指令。
// turnIndex 是**全局**序号（turnBaseOffset + 窗口内位置），窗口滚动后
// 仍能定位——translation-done 靠它把异步回来的译文放回正确的行；用窗口
// 内下标会在滚动后把译文贴到别人身上。降级后不再产出翻译指令。
function appendTurns(state, sources) {
  let turns = state.turns;
  let turnBaseOffset = state.turnBaseOffset;
  // 完整账本只属于有限时长的视频：AI 批量翻译和侧边栏需要回填整段。
  // 直播只显示滑动窗口，保留一小时所有话轮会把常驻 offscreen 文档的内存
  // 随观看时长无上限增长。
  let translationRecords = state.scene === "video" ? (state.translationRecords ?? []) : [];
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
      translationEngine: state.translationEngine ?? TRANSLATION_ENGINE.BUILTIN,
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

// 事件：
//   user-start {streamId, scene, translateTrigger, translationEngine} / user-stop
//   set-translation-engine {translationEngine}（仅视频场景）
//   audio-chunk {rms, chunk}       转写链路产出一个音频块
//   socket-open                    WebSocket 已开始会话（收到 Begin）
//   socket-close                   WebSocket 关闭（是否计划内由 reducer 判断）
//   socket-error {error:{kind}}    kind: "auth" | "network"（宿主分类后传入）
//   asr-turn {transcript, endOfTurn, formatted}
//   translation-done {turnIndex, text} / batch-translation-done {translations}
//   translation-failed
//   audio-track-ended              音频轨结束（关标签页/直播断流）
//   video-playthrough-complete     视频已自然播放并循环回起点（仅视频场景）
//   tick {dtSeconds}               时钟 tick（会话计时 + 重连退避到期检查）
//
// 指令：
//   start-capture {streamId} / stop-capture
//   open-socket {reason}           reason: "initial" | "voice-resumed" | "retry"
//   send-audio {chunk}
//   close-socket {reason?}         reason: "idle" 表示静音断连（宿主据此报待机）
//   translate {turnIndex, text} / batch-translate {units}
//   translation-degraded           翻译失败降级（宿主做一次性提示）
//   session-ended {reason}
export function sessionReducer(state, event) {
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
            pendingBatch: [],
          },
          commands: [
            { type: "start-capture", streamId: event.streamId },
            { type: "open-socket", reason: "initial" },
          ],
        };
      }
      return { state, commands: [] };
    }

    case "audio-chunk": {
      if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };

      const voiced = event.rms >= VOICE_RMS_THRESHOLD;

      // 预缓冲环形更新（最近 ~2 秒，无论是否已实时发送过——重连后的新
      // 会话没见过它们，冲出去正好接住重新开口的头几个字）
      const prebuffer = [...(state.prebuffer ?? []), event.chunk];
      if (prebuffer.length > PREBUFFER_CHUNKS) {
        prebuffer.splice(0, prebuffer.length - PREBUFFER_CHUNKS);
      }

      if (state.status === SESSION_STATUS.IDLE) {
        if (!voiced) {
          return { state: { ...state, prebuffer, chunkCount: state.chunkCount + 1 }, commands: [] };
        }
        // 重新开口：换新 token 重连（ADR-0005——token 一次性）
        return {
          state: {
            ...state,
            prebuffer,
            chunkCount: state.chunkCount + 1,
            status: SESSION_STATUS.CAPTURING,
            connection: CONNECTION_STATUS.CONNECTING,
          },
          commands: [{ type: "open-socket", reason: "voice-resumed" }],
        };
      }

      if (
        state.status === SESSION_STATUS.CAPTURING &&
        state.connection === CONNECTION_STATUS.OPEN
      ) {
        const silenceChunks = voiced ? 0 : (state.silenceChunks ?? 0) + 1;
        if (silenceChunks >= IDLE_AFTER_SILENT_CHUNKS) {
          // 计划内断连：音频继续采集，只是不再上传（不再计费）
          return {
            state: {
              ...state,
              prebuffer,
              chunkCount: state.chunkCount + 1,
              silenceChunks: 0,
              status: SESSION_STATUS.IDLE,
              connection: CONNECTION_STATUS.CLOSED,
              socketCloseExpected: true,
            },
            commands: [{ type: "close-socket", reason: "idle" }],
          };
        }
        return {
          state: { ...state, prebuffer, silenceChunks, chunkCount: state.chunkCount + 1 },
          commands: [{ type: "send-audio", chunk: event.chunk }],
        };
      }

      // capturing 但连接未开（connecting），或 reconnecting：只进预缓冲
      return {
        state: { ...state, prebuffer, chunkCount: state.chunkCount + 1 },
        commands: [],
      };
    }

    case "socket-open": {
      if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
      // 预缓冲冲出（连接期间积累的音频块，按原顺序），随后清空——
      // 冲出是一次性的，后续音频块只实时发送
      const flush = (state.prebuffer ?? []).map((chunk) => ({
        type: "send-audio",
        chunk,
      }));
      return {
        state: {
          ...state,
          status: SESSION_STATUS.CAPTURING,
          connection: CONNECTION_STATUS.OPEN,
          prebuffer: [],
          reconnectAttempts: 0,
          retryAtSeconds: null,
        },
        commands: flush,
      };
    }

    case "socket-close": {
      if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
      // 计划内关闭（idle 断连 / 终止路径已发过 close-socket）：静默记录
      if (state.socketCloseExpected) {
        return {
          state: { ...state, connection: CONNECTION_STATUS.CLOSED, socketCloseExpected: false },
          commands: [],
        };
      }
      // 意外断连（网络掉线、服务端关闭）：走退避重连
      return scheduleReconnect(state);
    }

    case "socket-error": {
      if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
      if (event.error?.kind === "auth") {
        // 鉴权类（Key 失效/余额耗尽/会话到限）：立即终止，绝不重连——
        // 每次重连都是新会话、都在计费（ADR-0005 最贵的 bug）
        return terminate(state, "auth-error", [
          { type: "close-socket" },
          { type: "stop-capture" },
        ]);
      }
      return scheduleReconnect(state);
    }

    case "asr-turn": {
      if (state.status !== SESSION_STATUS.CAPTURING) return { state, commands: [] };

      // partial（含未格式化的 end-of-turn）携带的是该话轮从头到当前的
      // **整句**文本——实测每条都重复之前的内容，不是增量。所以处处用替换
      // 而不是追加，追加会把 partial 滚成全文重复 N 遍。
      const endOfTurn = Boolean(event.endOfTurn && event.formatted);

      if (state.translateTrigger === TRANSLATE_TRIGGER.SENTENCE) {
        // 句子模式：不等停顿，说完一句就定稿。水位线记的是「已发出的句
        // 数」而不是字符偏移——每帧都对全文重新切句、跳过前 N 句。ASR 若
        // 回头改写标点把两句并成一句，句数变少，这里只是不再新发，绝不会
        // 重复出字幕；用字符偏移则会错位半个词。
        const { sentences, tail } = splitStableSentences(event.transcript);
        const pending = sentences.slice(state.emittedSentences ?? 0);
        // 话轮结束时无条件冲出尾巴：静音常常切在半句上（`...escogiendo
        // en`），不冲这半句就永远出不来
        if (endOfTurn && tail) pending.push(tail);

        const appended = appendTurns(state, pending);
        return {
          state: {
            ...state,
            ...appended.next,
            // 已定稿的句子从 partial 里剪掉，只留还在写的尾巴——否则同一
            // 句西语会同时出现在定稿行和滚动行
            partial: endOfTurn ? "" : tail,
            emittedSentences: endOfTurn ? 0 : sentences.length,
          },
          commands: appended.commands,
        };
      }

      if (endOfTurn) {
        // 停顿模式：整个话轮一次性定稿（ADR-0002 的原始设计）
        const appended = appendTurns(state, [event.transcript]);
        return {
          state: { ...state, ...appended.next, partial: "" },
          commands: appended.commands,
        };
      }
      return {
        state: { ...state, partial: event.transcript },
        commands: [],
      };
    }

    case "translation-done": {
      // 局部内置译文可能在会话刚结束后才返回；记录仍属于这场会话，因此
      // inactive 时也允许它回填，绝不丢掉用户已经等待过的结果。
      const records = (state.translationRecords ?? []).map((record) =>
        record.turnIndex === event.turnIndex
          ? { ...record, translation: event.text }
          : record
      );
      const recordMatched = records.some((record) => record.turnIndex === event.turnIndex);
      const windowIndex = event.turnIndex - state.turnBaseOffset;
      const turns = state.turns?.slice() ?? [];
      const turnMatched =
        Number.isInteger(windowIndex) && windowIndex >= 0 && windowIndex < turns.length;
      if (turnMatched) {
        turns[windowIndex] = { ...turns[windowIndex], translation: event.text };
      }
      return recordMatched || turnMatched
        ? { state: { ...state, turns, translationRecords: records }, commands: [] }
        : { state, commands: [] };
    }

    case "batch-translation-done": {
      const translations = new Map(
        (event.translations ?? []).map(({ turnIndex, text }) => [turnIndex, text])
      );
      if (translations.size === 0) return { state, commands: [] };
      const translationRecords = (state.translationRecords ?? []).map((record) =>
        translations.has(record.turnIndex)
          ? { ...record, translation: translations.get(record.turnIndex) }
          : record
      );
      const turns = (state.turns ?? []).map((turn, index) => {
        const turnIndex = (state.turnBaseOffset ?? 0) + index;
        return translations.has(turnIndex)
          ? { ...turn, translation: translations.get(turnIndex) }
          : turn;
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
            translationError: null,
          },
          commands: [],
        };
      }
      return { state, commands: [] };
    }

    case "translation-failed": {
      // 视频会话允许用户随后切到 AI 引擎；本地模型暂不可用不能把整条
      // 视频会话永久降级，否则切换只会看起来像成功、后续单位却永远不翻。
      if (ACTIVE_STATUSES.has(state.status) && state.scene === "video") {
        return {
          state: { ...state, translationError: event.error?.message ?? "本地翻译失败。" },
          commands: [],
        };
      }
      // 降级只切换一次：后续失败不再重复提示（ADR-0002：错误说明不常驻）
      if (ACTIVE_STATUSES.has(state.status) && !state.translationDegraded) {
        return {
          state: { ...state, translationDegraded: true },
          commands: [{ type: "translation-degraded" }],
        };
      }
      return { state, commands: [] };
    }

    case "user-stop": {
      if (ACTIVE_STATUSES.has(state.status)) {
        return terminate(state, "user-stop", [
          { type: "close-socket" },
          { type: "stop-capture" },
        ]);
      }
      return { state, commands: [] };
    }

    case "capture-failed": {
      if (state.status === SESSION_STATUS.CAPTURING) {
        const wasConnected = state.connection !== CONNECTION_STATUS.CLOSED;
        // capture-failed 只回到 inactive，不产出 stop-capture——捕获根本
        // 没有建立起来（但它可能已建了 socket，socket 要关）
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
          { type: "stop-capture" },
        ]);
      }
      return { state, commands: [] };
    }

    case "video-playthrough-complete": {
      if (ACTIVE_STATUSES.has(state.status) && state.scene === "video") {
        return terminate(state, "video-playthrough", [
          { type: "close-socket" },
          { type: "stop-capture" },
        ]);
      }
      return { state, commands: [] };
    }

    case "tick": {
      if (!ACTIVE_STATUSES.has(state.status)) return { state, commands: [] };
      const sessionSeconds = state.sessionSeconds + (event.dtSeconds ?? 0);
      if (sessionSeconds >= SESSION_CAP_SECONDS) {
        // 会话硬上限：服务端同一刻也会强制收尾；客户端主动结束并
        // 记录原因，让用户看到「可以重新开始」的明确提示
        return terminate(state, "session-cap", [
          { type: "close-socket" },
          { type: "stop-capture" },
        ]);
      }
      if (
        state.status === SESSION_STATUS.RECONNECTING &&
        state.retryAtSeconds !== null &&
        sessionSeconds >= state.retryAtSeconds
      ) {
        return {
          state: {
            ...state,
            sessionSeconds,
            status: SESSION_STATUS.CAPTURING,
            connection: CONNECTION_STATUS.CONNECTING,
            retryAtSeconds: null,
          },
          commands: [{ type: "open-socket", reason: "retry" }],
        };
      }
      return { state: { ...state, sessionSeconds }, commands: [] };
    }

    default:
      return { state, commands: [] };
  }
}
