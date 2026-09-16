import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionState,
  sessionReducer,
  SESSION_CAP_SECONDS,
  IDLE_AFTER_MS,
  VOICE_RMS_THRESHOLD,
  MAX_RECONNECT_ATTEMPTS,
  classifyAsrError,
  splitStableSentences,
} from "./session.js";
import { CHUNK_SAMPLES, CHUNK_MS } from "./audio.js";

test("start when inactive issues the start-capture command carrying the streamId", () => {
  const { state, commands } = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "s-1",
  });
  assert.equal(state.status, "capturing");
  assert.equal(commands[0].type, "start-capture");
  assert.equal(commands[0].streamId, "s-1");
});

test("start while already capturing is ignored — no commands, no state change", () => {
  const capturing = { status: "capturing" };
  const { state, commands } = sessionReducer(capturing, { type: "user-start" });
  assert.equal(state, capturing);
  assert.deepEqual(commands, []);
});

test("stop while capturing issues close-socket then stop-capture", () => {
  const { state, commands } = sessionReducer(capturingState(), { type: "user-stop" });
  assert.equal(state.status, "inactive");
  assert.deepEqual(commands.map((c) => c.type), [
    "close-socket",
    "stop-capture",
    "session-ended",
  ]);
});

test("capture-failed while the socket is still connecting issues close-socket only", () => {
  const { state, commands } = sessionReducer(capturingState(), {
    type: "capture-failed",
  });
  assert.equal(state.status, "inactive");
  assert.deepEqual(commands.map((c) => c.type), ["close-socket", "session-ended"]);
});

test("stop when inactive is ignored — no commands", () => {
  const inactive = createSessionState();
  const { state, commands } = sessionReducer(inactive, { type: "user-stop" });
  assert.equal(state, inactive);
  assert.deepEqual(commands, []);
});

test("a failed capture start releases the state back to inactive so a retry works", () => {
  const { state } = sessionReducer(capturingState(), {
    type: "capture-failed",
  });
  assert.equal(state.status, "inactive");

  const retry = sessionReducer(state, { type: "user-start", streamId: "s-2" });
  assert.equal(retry.commands[0].type, "start-capture");
  assert.equal(retry.commands[0].streamId, "s-2");
});

test("tick passes through without commands in every state", () => {
  const states = [
    createSessionState(),
    sessionReducer(createSessionState(), { type: "user-start", streamId: "s" }).state,
  ];
  for (const state of states) {
    const { state: next, commands } = sessionReducer(state, { type: "tick", dtSeconds: 1 });
    assert.equal(next.status, state.status);
    assert.deepEqual(commands, []);
  }
});

test("audio-chunk events are ignored when not capturing", () => {
  const inactive = createSessionState();
  const { state, commands } = sessionReducer(inactive, {
    type: "audio-chunk",
    rms: 0.1,
  });
  assert.equal(state, inactive);
  assert.deepEqual(commands, []);
});

test("audio-chunk events while capturing update the chunk count", () => {
  let { state } = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "s-1",
  });
  state = sessionReducer(state, { type: "audio-chunk", rms: 0.2 }).state;
  state = sessionReducer(state, { type: "audio-chunk", rms: 0.4 }).state;

  assert.equal(state.status, "capturing");
  assert.equal(state.chunkCount, 2);
});

// ---- 连接生命周期（ticket 04）----

function capturingState() {
  return sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "s-1",
  }).state;
}

test("start issues start-capture then open-socket, in that order", () => {
  const { commands } = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "s-1",
  });
  assert.deepEqual(commands.map((c) => c.type), ["start-capture", "open-socket"]);
});

test("stop while capturing issues close-socket before stop-capture", () => {
  const { commands } = sessionReducer(capturingState(), { type: "user-stop" });
  assert.deepEqual(commands.map((c) => c.type), [
    "close-socket",
    "stop-capture",
    "session-ended",
  ]);
});

test("socket-open marks the connection open; socket-close/error mark it closed", () => {
  let { state } = sessionReducer(capturingState(), { type: "socket-open" });
  assert.equal(state.connection, "open");

  state = sessionReducer(state, { type: "socket-close" }).state;
  assert.equal(state.connection, "closed");

  state = sessionReducer(state, { type: "socket-open" }).state;
  state = sessionReducer(state, { type: "socket-error", error: { kind: "network" } }).state;
  assert.equal(state.connection, "closed");
});

test("audio-chunk when the socket is not open produces no send command", () => {
  const { commands } = sessionReducer(capturingState(), {
    type: "audio-chunk",
    rms: 0.1,
    chunk: new Int16Array(1024),
  });
  assert.deepEqual(commands, []);
});

test("audio-chunk while open produces send-audio carrying the chunk", () => {
  const open = sessionReducer(capturingState(), { type: "socket-open" }).state;
  const chunk = new Int16Array(1024);
  const { state, commands } = sessionReducer(open, {
    type: "audio-chunk",
    rms: 0.1,
    chunk,
  });
  assert.deepEqual(commands, [{ type: "send-audio", chunk }]);
  assert.equal(state.chunkCount, open.chunkCount + 1);
});

// ---- ASR 话轮消息（ticket 04）----

function openState() {
  return sessionReducer(capturingState(), { type: "socket-open" }).state;
}

test("partial turn messages replace the in-progress text (they carry the whole turn so far), no finalized turn", () => {
  let { state, commands } = sessionReducer(openState(), {
    type: "asr-turn",
    transcript: "Hola, ",
    endOfTurn: false,
    formatted: false,
  });
  ({ state, commands } = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Hola, ¿cómo estás?",
    endOfTurn: false,
    formatted: false,
  }));

  assert.equal(state.partial, "Hola, ¿cómo estás?");
  assert.deepEqual(state.turns, []);
  assert.deepEqual(commands, []);
});

test("a raw end-of-turn (not yet formatted) replaces partial with the full turn text, no duplicate", () => {
  let { state } = sessionReducer(openState(), {
    type: "asr-turn",
    transcript: "Hola, ¿cómo estás?",
    endOfTurn: false,
    formatted: false,
  });
  ({ state } = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Hola, ¿cómo estás?",
    endOfTurn: true,
    formatted: false,
  }));

  assert.equal(state.partial, "Hola, ¿cómo estás?");
  assert.deepEqual(state.turns, []);
});

test("a formatted end-of-turn finalizes the turn and clears the partial", () => {
  let { state } = sessionReducer(openState(), {
    type: "asr-turn",
    transcript: "Hola, ",
    endOfTurn: false,
    formatted: false,
  });
  ({ state } = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Hola, ¿cómo estás?",
    endOfTurn: true,
    formatted: true,
  }));

  assert.equal(state.partial, "");
  assert.deepEqual(state.turns, [{ source: "Hola, ¿cómo estás?", translation: "" }]);
});

test("asr-turn events are ignored when not capturing", () => {
  const inactive = createSessionState();
  const { state, commands } = sessionReducer(inactive, {
    type: "asr-turn",
    transcript: "Hola",
    endOfTurn: true,
    formatted: true,
  });
  assert.equal(state, inactive);
  assert.deepEqual(commands, []);
});

// ---- 翻译（ticket 05）----

test("a formatted end-of-turn stores a turn with empty translation and issues one translate command", () => {
  let { state } = sessionReducer(openState(), {
    type: "asr-turn",
    transcript: "Hola, ",
    endOfTurn: false,
    formatted: false,
  });
  const { state: next, commands } = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Hola, ¿cómo estás?",
    endOfTurn: true,
    formatted: true,
  });

  assert.deepEqual(next.turns, [{ source: "Hola, ¿cómo estás?", translation: "" }]);
  assert.deepEqual(commands, [
    { type: "translate", turnIndex: 0, text: "Hola, ¿cómo estás?" },
  ]);
});

test("in-progress turns never issue a translate command", () => {
  let { state, commands } = sessionReducer(openState(), {
    type: "asr-turn",
    transcript: "Hola, ",
    endOfTurn: false,
    formatted: false,
  });
  assert.deepEqual(commands, []);
  ({ state, commands } = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Hola, ¿cómo?",
    endOfTurn: false,
    formatted: false,
  }));
  assert.deepEqual(commands, []);
  assert.deepEqual(state.turns, []);
});

test("translation-done fills the turn's translation without touching others", () => {
  let { state } = sessionReducer(openState(), {
    type: "asr-turn",
    transcript: "Primera.",
    endOfTurn: true,
    formatted: true,
  });
  state = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Segunda.",
    endOfTurn: true,
    formatted: true,
  }).state;

  const { state: next } = sessionReducer(state, {
    type: "translation-done",
    turnIndex: 0,
    text: "第一句。",
  });

  assert.equal(next.turns[0].translation, "第一句。");
  assert.equal(next.turns[1].translation, "");
  // 字幕视图同步更新（同一条话轮的两个出口，内容必须一致）
  assert.equal(next.turns[0].translation, "第一句。");
});

test("translation-done for an out-of-range index is ignored", () => {
  const { state, commands } = sessionReducer(openState(), {
    type: "translation-done",
    turnIndex: 7,
    text: "???",
  });
  assert.deepEqual(commands, []);
  assert.deepEqual(state.turns, []);
});

// ---- 字幕双轨（ticket 06）----

test("subtitle keeps only the last 2 finalized turns; oldest is dropped", () => {
  let { state } = sessionReducer(openState(), {
    type: "asr-turn", transcript: "Primera.", endOfTurn: true, formatted: true,
  });
  state = sessionReducer(state, {
    type: "asr-turn", transcript: "Segunda.", endOfTurn: true, formatted: true,
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn", transcript: "Tercera.", endOfTurn: true, formatted: true,
  }).state;

  assert.deepEqual(
    state.turns.map((t) => t.source),
    ["Segunda.", "Tercera."]
  );
});

test("in-progress turn updates only the source track, never enters subtitle history", () => {
  let state = sessionReducer(openState(), {
    type: "asr-turn", transcript: "Primera.", endOfTurn: true, formatted: true,
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn", transcript: "En curso…", endOfTurn: false, formatted: false,
  }).state;

  assert.equal(state.partial, "En curso…");
  assert.equal(state.turns.length, 1);
});

test("translation-done updates the matching subtitle entry", () => {
  let state = sessionReducer(openState(), {
    type: "asr-turn", transcript: "Primera.", endOfTurn: true, formatted: true,
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn", transcript: "Segunda.", endOfTurn: true, formatted: true,
  }).state;

  const { state: next } = sessionReducer(state, {
    type: "translation-done",
    turnIndex: 1,
    text: "第二句。",
  });

  assert.deepEqual(
    next.turns,
    [
      { source: "Primera.", translation: "" },
      { source: "Segunda.", translation: "第二句。" },
    ]
  );
});

test("translation-done with an index evicted from the window is ignored", () => {
  let state = sessionReducer(openState(), {
    type: "asr-turn", transcript: "A.", endOfTurn: true, formatted: true,
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn", transcript: "B.", endOfTurn: true, formatted: true,
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn", transcript: "C.", endOfTurn: true, formatted: true,
  }).state;

  // A（绝对索引 0）已被顶出 2 条窗口——晚到的译文要被忽略而不是错写进 B
  const { state: next } = sessionReducer(state, {
    type: "translation-done",
    turnIndex: 0,
    text: "已被顶出的译文。",
  });
  assert.deepEqual(next.turns.map((t) => t.translation), ["", ""]);
});

test("user-start resets the subtitle for a fresh session", () => {
  let state = sessionReducer(openState(), {
    type: "asr-turn", transcript: "Vieja.", endOfTurn: true, formatted: true,
  }).state;
  state = sessionReducer(state, { type: "user-stop" }).state;

  const { state: fresh } = sessionReducer(state, {
    type: "user-start",
    streamId: "s-9",
  });
  assert.deepEqual(fresh.turns, []);
  assert.equal(fresh.partial, "");
  assert.equal(fresh.turnBaseOffset, 0);
});

// ---- 花钱保险丝（ticket 07）----

test("ticks advance session seconds only while capturing", () => {
  let { state } = sessionReducer(capturingState(), { type: "tick", dtSeconds: 1 });
  state = sessionReducer(state, { type: "tick", dtSeconds: 1 }).state;
  assert.equal(state.sessionSeconds, 2);

  // 停止后 tick 不再推进（计时停在终止时刻，popup 仍可显示最终时长）
  const inactive = sessionReducer(state, { type: "user-stop" }).state;
  const { state: after } = sessionReducer(inactive, { type: "tick", dtSeconds: 5 });
  assert.equal(after.sessionSeconds, 2);
});

test("reaching the session cap emits close-socket + stop-capture with a reason, and terminates", () => {
  let state = sessionReducer(capturingState(), {
    type: "tick",
    dtSeconds: SESSION_CAP_SECONDS,
  }).state;

  assert.equal(state.status, "inactive");
  assert.equal(state.stopReason, "session-cap");
  // 终止要可观察，popup/浮层据此提示「可重新开始」
  const { commands } = sessionReducer(capturingState(), {
    type: "tick",
    dtSeconds: SESSION_CAP_SECONDS,
  });
  assert.deepEqual(commands.map((c) => c.type), [
    "close-socket",
    "stop-capture",
    "session-ended",
  ]);
});

test("audio-track-ended emits the full stop command sequence from any live state", () => {
  let state = capturingState();
  state = sessionReducer(state, { type: "socket-open" }).state;

  const { state: next, commands } = sessionReducer(state, {
    type: "audio-track-ended",
  });
  assert.equal(next.status, "inactive");
  assert.equal(next.stopReason, "audio-ended");
  assert.deepEqual(commands.map((c) => c.type), [
    "close-socket",
    "stop-capture",
    "session-ended",
  ]);
});

test("audio-track-ended when inactive produces nothing", () => {
  const inactive = createSessionState();
  const { state, commands } = sessionReducer(inactive, { type: "audio-track-ended" });
  assert.equal(state, inactive);
  assert.deepEqual(commands, []);
});

test("user-stop from any capturing sub-state always terminates", () => {
  const socketConnecting = capturingState();
  const socketOpen = sessionReducer(capturingState(), { type: "socket-open" }).state;
  const socketClosedAgain = sessionReducer(
    sessionReducer(capturingState(), { type: "socket-open" }).state,
    { type: "socket-close" }
  ).state;

  for (const state of [socketConnecting, socketOpen, socketClosedAgain]) {
    const { state: next, commands } = sessionReducer(state, { type: "user-stop" });
    assert.equal(next.status, "inactive");
    assert.deepEqual(commands.map((c) => c.type), [
      "close-socket",
      "stop-capture",
      "session-ended",
    ]);
  }
});

test("tick carries a session-status snapshot for the popup timer", () => {
  const { state } = sessionReducer(capturingState(), { type: "tick", dtSeconds: 42 });
  assert.equal(state.status, "capturing");
  assert.equal(state.sessionSeconds, 42);
});

// ---- 长静音自动断连与预缓冲（ticket 08）----

const SILENT = { type: "audio-chunk", rms: 0, chunk: new Int16Array(CHUNK_SAMPLES) };
const VOICED = { type: "audio-chunk", rms: 0.1, chunk: new Int16Array(CHUNK_SAMPLES).fill(1000) };
const CHUNKS_FOR_IDLE = Math.ceil(IDLE_AFTER_MS / CHUNK_MS);

test("silence threshold reached emits close-socket(idle) but NOT stop-capture", () => {
  let state = openState();
  let commands = [];
  for (let i = 0; i < CHUNKS_FOR_IDLE; i++) {
    const r = sessionReducer(state, SILENT);
    state = r.state;
    commands = r.commands;
  }

  assert.equal(state.status, "idle");
  assert.equal(commands.filter((c) => c.type === "close-socket").length, 1);
  assert.equal(commands.find((c) => c.type === "close-socket").reason, "idle");
  // 捕获本身继续运行（音频仍在采集，只是不再上传）
  assert.equal(commands.filter((c) => c.type === "stop-capture").length, 0);
});

test("silence below the threshold emits no close-socket", () => {
  let state = openState();
  for (let i = 0; i < CHUNKS_FOR_IDLE - 1; i++) {
    state = sessionReducer(state, SILENT).state;
  }
  assert.equal(state.status, "capturing");
});

test("natural pauses shorter than the threshold never accumulate to a disconnect", () => {
  let state = openState();
  const pause = Math.floor(CHUNKS_FOR_IDLE / 10);
  for (let round = 0; round < 15; round++) {
    for (let i = 0; i < pause; i++) state = sessionReducer(state, SILENT).state;
    state = sessionReducer(state, VOICED).state; // 语音重置静音累计
  }
  assert.equal(state.status, "capturing");
});

test("voice while idle reconnects: emits open-socket(voice-resumed)", () => {
  let state = openState();
  for (let i = 0; i < CHUNKS_FOR_IDLE; i++) state = sessionReducer(state, SILENT).state;
  assert.equal(state.status, "idle");

  const { state: next, commands } = sessionReducer(state, VOICED);
  assert.equal(next.status, "capturing");
  assert.deepEqual(commands, [{ type: "open-socket", reason: "voice-resumed" }]);
});

test("prebuffer holds ~2s of chunks and is flushed once on socket-open, never re-flushed", () => {
  // 待机中积累音频块（不发送），超过容量的丢最旧的
  let state = openState();
  for (let i = 0; i < CHUNKS_FOR_IDLE; i++) state = sessionReducer(state, SILENT).state;
  const marks = [];
  for (let i = 0; i < 40; i++) {
    const chunk = new Int16Array(CHUNK_SAMPLES).fill(i + 1);
    marks.push(i + 1);
    state = sessionReducer(state, { type: "audio-chunk", rms: 0, chunk }).state;
  }
  // 环形：只留最近 ~2 秒
  assert.equal(state.prebuffer.length, 31);
  assert.equal(state.prebuffer[0][0], 40 - 31 + 1);

  // 语音触发重连（这块语音本身也进预缓冲，挤掉最旧的静音块）
  state = sessionReducer(state, VOICED).state;
  // socket-open：预缓冲按原顺序冲出，然后清空
  const opened = sessionReducer(state, { type: "socket-open" });
  const flushed = opened.commands.filter((c) => c.type === "send-audio");
  assert.equal(flushed.length, 31);
  assert.equal(flushed[0].chunk[0], 40 - 31 + 2);
  assert.equal(flushed[30].chunk[0], 1000); // 最后冲出的是触发重连的那块语音
  assert.equal(opened.state.prebuffer.length, 0);

  // 后续音频块只实时发送一次，不重复冲出
  const live = sessionReducer(opened.state, VOICED);
  assert.equal(live.commands.filter((c) => c.type === "send-audio").length, 1);
  const reopened = sessionReducer(live.state, { type: "socket-open" });
  // 再次 open（理论上不会发生）也只冲出上次冲空后新积累的块
  assert.equal(
    reopened.commands.filter((c) => c.type === "send-audio").length,
    live.state.prebuffer.length
  );
});

test("expected close (idle) does not trigger reconnect on socket-close", () => {
  let state = openState();
  for (let i = 0; i < CHUNKS_FOR_IDLE; i++) state = sessionReducer(state, SILENT).state;

  const { state: after } = sessionReducer(state, { type: "socket-close" });
  assert.equal(after.status, "idle");
  assert.equal(after.reconnectAttempts, 0);
});

// ---- 意外断连、错误分类与降级（ticket 09）----

test("classifyAsrError: auth-class codes terminate, others are network", () => {
  assert.equal(classifyAsrError(1008), "auth");
  assert.equal(classifyAsrError(3008), "auth"); // 会话到限：重连=绕过故意摩擦，终止
  assert.equal(classifyAsrError(1006), "network");
  assert.equal(classifyAsrError(3005), "network");
  assert.equal(classifyAsrError(3009), "network");
  assert.equal(classifyAsrError(1011), "network");
});

test("auth error terminates with NO open-socket anywhere in the command sequence", () => {
  const state = openState();
  const { state: next, commands } = sessionReducer(state, {
    type: "socket-error",
    error: { kind: "auth" },
  });

  assert.equal(next.status, "inactive");
  assert.equal(next.stopReason, "auth-error");
  assert.equal(commands.filter((c) => c.type === "open-socket").length, 0);
  assert.deepEqual(commands.map((c) => c.type), [
    "close-socket",
    "stop-capture",
    "session-ended",
  ]);
});

test("network error backs off exponentially; retry fires on tick, not immediately", () => {
  let state = openState();

  const first = sessionReducer(state, {
    type: "socket-error",
    error: { kind: "network" },
  });
  assert.equal(first.state.status, "reconnecting");
  assert.equal(first.state.reconnectAttempts, 1);
  assert.equal(first.commands.length, 0); // 不立即重连

  // 退避 2^0 = 1 秒：第 1 秒的 tick 触发重连
  const t1 = sessionReducer(first.state, { type: "tick", dtSeconds: 1 });
  assert.deepEqual(t1.commands.map((c) => c.type), ["open-socket"]);
  assert.equal(t1.state.status, "capturing");

  // 重连尝试失败（尚未成功建连，计数继续累加）：退避 2 秒
  const second = sessionReducer(t1.state, {
    type: "socket-error",
    error: { kind: "network" },
  });
  assert.equal(second.state.reconnectAttempts, 2);
  const early = sessionReducer(second.state, { type: "tick", dtSeconds: 1 });
  assert.equal(early.commands.length, 0); // 未到退避时间
  const due = sessionReducer(second.state, { type: "tick", dtSeconds: 2 });
  assert.deepEqual(due.commands.map((c) => c.type), ["open-socket"]);
});

test("exhausting MAX_RECONNECT_ATTEMPTS terminates with a clear reason", () => {
  let state = openState();
  let last;
  for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) {
    last = sessionReducer(state, { type: "socket-error", error: { kind: "network" } });
    state = last.state;
    if (last.state.status === "reconnecting") {
      // 模拟退避到点 → 重连 → 再失败
      state = sessionReducer(state, { type: "tick", dtSeconds: 16 }).state;
    }
  }
  assert.equal(last.state.status, "inactive");
  assert.equal(last.state.stopReason, "reconnect-exhausted");
});

test("unexpected socket-close while open enters the reconnect path", () => {
  const state = openState();
  const { state: next } = sessionReducer(state, { type: "socket-close" });
  assert.equal(next.status, "reconnecting");
  assert.equal(next.reconnectAttempts, 1);
});

test("Error-frame then onclose counts as ONE disconnect, not two", () => {
  // 服务端先发 Error 帧（→ socket-error）再关连接（→ socket-close），
  // 同一次断连不能烧两次退避计数
  let state = openState();
  state = sessionReducer(state, { type: "socket-error", error: { kind: "network" } }).state;
  assert.equal(state.reconnectAttempts, 1);

  const { state: after } = sessionReducer(state, { type: "socket-close" });
  assert.equal(after.status, "reconnecting");
  assert.equal(after.reconnectAttempts, 1);
});

test("successful reconnect resets the attempt counter", () => {
  let state = openState();
  state = sessionReducer(state, { type: "socket-error", error: { kind: "network" } }).state;
  state = sessionReducer(state, { type: "tick", dtSeconds: 1 }).state;
  state = sessionReducer(state, { type: "socket-open" }).state;
  assert.equal(state.reconnectAttempts, 0);
});

// ---- 翻译失败降级（ticket 09）----

test("translation-failed switches to degraded mode exactly once", () => {
  let state = openState();

  const first = sessionReducer(state, { type: "translation-failed" });
  assert.equal(first.state.translationDegraded, true);
  assert.deepEqual(first.commands.map((c) => c.type), ["translation-degraded"]);

  // 第二次失败不再重复提示
  const second = sessionReducer(first.state, { type: "translation-failed" });
  assert.deepEqual(second.commands, []);

  // 降级后定稿话轮入列但不再产出翻译指令
  const turn = sessionReducer(second.state, {
    type: "asr-turn", transcript: "Sigue.", endOfTurn: true, formatted: true,
  });
  assert.equal(turn.state.turns.length, 1);
  assert.equal(turn.commands.filter((c) => c.type === "translate").length, 0);
});

// ---- 句子触发模式（说完一句就翻译，不等停顿）----

function sentenceModeState() {
  const started = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "s-1",
    translateTrigger: "sentence",
  }).state;
  return sessionReducer(started, { type: "socket-open" }).state;
}

function partial(state, transcript) {
  return sessionReducer(state, {
    type: "asr-turn",
    transcript,
    endOfTurn: false,
    formatted: true,
  });
}

test("splitStableSentences: a period at the very end is NOT a boundary (ASR rewrites it)", () => {
  // 实测：`...viene en la mayoría.` 下一帧变成 `...viene en la mayoría de las
  // cajoneras.`——按末尾句号翻译会产出无法收回的错译
  assert.deepEqual(splitStableSentences("Viene en la mayoría."), {
    sentences: [],
    tail: "Viene en la mayoría.",
  });
});

test("splitStableSentences: a period with text after it IS a boundary", () => {
  assert.deepEqual(
    splitStableSentences("Viene en la mayoría. Este cajón"),
    { sentences: ["Viene en la mayoría."], tail: "Este cajón" }
  );
});

test("splitStableSentences: decimals are not sentence boundaries (no space after the dot)", () => {
  assert.deepEqual(splitStableSentences("Cuesta 12.5 euros y algo"), {
    sentences: [],
    tail: "Cuesta 12.5 euros y algo",
  });
});

test("splitStableSentences: fragments under 2 words merge into the next sentence", () => {
  assert.deepEqual(splitStableSentences("y. entonces vamos a ver. Ahora"), {
    sentences: ["y. entonces vamos a ver."],
    tail: "Ahora",
  });
});

test("sentence mode: a completed sentence is finalized mid-turn, without waiting for the pause", () => {
  const { state, commands } = partial(
    sentenceModeState(),
    "Este es el cajón más grande, chicos. Este es"
  );
  assert.deepEqual(state.turns, [
    { source: "Este es el cajón más grande, chicos.", translation: "" },
  ]);
  assert.deepEqual(commands, [
    { type: "translate", turnIndex: 0, text: "Este es el cajón más grande, chicos." },
  ]);
  // 已定稿的句子从 partial 里剪掉，只留还在写的尾巴
  assert.equal(state.partial, "Este es");
});

test("sentence mode: an already-emitted sentence is never re-emitted as the turn grows", () => {
  let { state } = partial(sentenceModeState(), "Uno de dos. Tres");
  let commands;
  ({ state, commands } = partial(state, "Uno de dos. Tres de cuatro"));
  assert.deepEqual(commands, []);
  assert.equal(state.turns.length, 1);
  ({ state, commands } = partial(state, "Uno de dos. Tres de cuatro. Cinco"));
  assert.deepEqual(commands, [
    { type: "translate", turnIndex: 1, text: "Tres de cuatro." },
  ]);
});

test("sentence mode: punctuation rewritten backwards (two sentences merging into one) never duplicates a subtitle", () => {
  // ASR 把 `en la de 12.` 改写成 `en la de 12,`——句数变少
  let { state } = partial(sentenceModeState(), "Viene en la de 12. Viene en");
  assert.equal(state.turns.length, 1);
  let commands;
  ({ state, commands } = partial(state, "Viene en la de 12, viene en la de 5. Y"));
  assert.deepEqual(commands, []);
  assert.equal(state.turns.length, 1);
});

test("sentence mode: end of turn flushes the unterminated tail so half a sentence is never lost", () => {
  let { state } = partial(sentenceModeState(), "Uno de dos. Yo lo estuve");
  const { state: next, commands } = sessionReducer(state, {
    type: "asr-turn",
    transcript: "Uno de dos. Yo lo estuve escogiendo en",
    endOfTurn: true,
    formatted: true,
  });
  assert.deepEqual(commands, [
    { type: "translate", turnIndex: 1, text: "Yo lo estuve escogiendo en" },
  ]);
  assert.equal(next.partial, "");
  // 水位线归零，下一个话轮从头数
  assert.equal(next.emittedSentences, 0);
});

test("sentence mode: degraded translation still finalizes subtitles, just without translate commands", () => {
  const degraded = { ...sentenceModeState(), translationDegraded: true };
  const { state, commands } = partial(degraded, "Uno de dos. Tres");
  assert.deepEqual(commands, []);
  assert.equal(state.turns.length, 1);
});

test("pause mode remains the default when no trigger is configured", () => {
  const started = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "s-1",
  }).state;
  assert.equal(started.translateTrigger, "pause");
  const open = sessionReducer(started, { type: "socket-open" }).state;
  const { state, commands } = partial(open, "Uno de dos. Tres");
  assert.deepEqual(commands, []);
  assert.deepEqual(state.turns, []);
  assert.equal(state.partial, "Uno de dos. Tres");
});

test("user-start retains the selected source language without changing session behavior", () => {
  const { state, commands } = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "stream-english",
    sourceLanguage: "en",
  });

  assert.equal(state.sourceLanguage, "en");
  assert.deepEqual(commands.map((command) => command.type), ["start-capture", "open-socket"]);
});

test("live captions keep only their visual window while video retains its full translation ledger", () => {
  let live = openState();
  live = sessionReducer(live, {
    type: "asr-turn",
    transcript: "直播里的一句字幕。",
    endOfTurn: true,
    formatted: true,
  }).state;
  assert.deepEqual(live.translationRecords, []);

  const video = videoSessionState();
  const recorded = sessionReducer(video, {
    type: "asr-turn",
    transcript: "视频里的一句字幕。",
    endOfTurn: true,
    formatted: true,
  }).state;
  assert.equal(recorded.translationRecords.length, 1);
});

function videoSessionState({ translateTrigger = "pause", translationEngine = "builtin" } = {}) {
  const started = sessionReducer(createSessionState(), {
    type: "user-start",
    streamId: "video-stream",
    scene: "video",
    translateTrigger,
    translationEngine,
  }).state;
  return sessionReducer(started, { type: "socket-open" }).state;
}

test("video AI engine is downstream of both translation-trigger modes", () => {
  for (const translateTrigger of ["pause", "sentence"]) {
    const state = videoSessionState({ translateTrigger, translationEngine: "ai" });
    const result = translateTrigger === "pause"
      ? sessionReducer(state, {
          type: "asr-turn",
          transcript: "Uno de dos.",
          endOfTurn: true,
          formatted: true,
        })
      : partial(state, "Uno de dos. Tres");

    assert.deepEqual(result.commands, []);
    assert.equal(result.state.pendingBatch.length, 1);
    assert.equal(result.state.pendingBatch[0].text, "Uno de dos.");
  }
});

test("switching a video engine preserves completed local translations and batches only later units", () => {
  let state = videoSessionState();
  let result = sessionReducer(state, {
    type: "asr-turn",
    transcript: "第一句。",
    endOfTurn: true,
    formatted: true,
  });
  state = sessionReducer(result.state, {
    type: "translation-done",
    turnIndex: 0,
    text: "第一句的本地译文。",
  }).state;

  result = sessionReducer(state, {
    type: "asr-turn",
    transcript: "第二句。",
    endOfTurn: true,
    formatted: true,
  });
  state = sessionReducer(result.state, {
    type: "translation-done",
    turnIndex: 1,
    text: "第二句的本地译文。",
  }).state;

  state = sessionReducer(state, {
    type: "set-translation-engine",
    translationEngine: "ai",
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn",
    transcript: "第三句。",
    endOfTurn: true,
    formatted: true,
  }).state;
  state = sessionReducer(state, {
    type: "asr-turn",
    transcript: "第四句。",
    endOfTurn: true,
    formatted: true,
  }).state;

  const stopped = sessionReducer(state, { type: "user-stop" });
  const batch = stopped.commands.find((command) => command.type === "batch-translate");
  assert.deepEqual(batch.units.map((unit) => unit.text), ["第三句。", "第四句。"]);

  const completed = sessionReducer(stopped.state, {
    type: "batch-translation-done",
    translations: [
      { turnIndex: 2, text: "第三句的批量译文。" },
      { turnIndex: 3, text: "第四句的批量译文。" },
    ],
  }).state;
  assert.deepEqual(
    completed.translationRecords.map(({ translationEngine, translation }) => ({ translationEngine, translation })),
    [
      { translationEngine: "builtin", translation: "第一句的本地译文。" },
      { translationEngine: "builtin", translation: "第二句的本地译文。" },
      { translationEngine: "ai", translation: "第三句的批量译文。" },
      { translationEngine: "ai", translation: "第四句的批量译文。" },
    ]
  );
});

test("a video playthrough completion stops only a video session and flushes its AI batch", () => {
  let state = videoSessionState({ translationEngine: "ai" });
  state = sessionReducer(state, {
    type: "asr-turn",
    transcript: "一轮播放里的字幕。",
    endOfTurn: true,
    formatted: true,
  }).state;

  const completed = sessionReducer(state, { type: "video-playthrough-complete" });
  assert.equal(completed.state.status, "inactive");
  assert.equal(completed.state.stopReason, "video-playthrough");
  assert.deepEqual(completed.commands.map((command) => command.type), [
    "close-socket",
    "stop-capture",
    "batch-translate",
    "session-ended",
  ]);

  const live = openState();
  assert.equal(sessionReducer(live, { type: "video-playthrough-complete" }).state, live);
});

test("a video local-translation failure leaves later AI engine switching possible", () => {
  let state = videoSessionState();
  state = sessionReducer(state, {
    type: "translation-failed",
    error: { message: "本地模型不可用" },
  }).state;

  assert.equal(state.translationDegraded, false);
  assert.equal(state.translationError, "本地模型不可用");
  state = sessionReducer(state, {
    type: "set-translation-engine",
    translationEngine: "ai",
  }).state;
  assert.equal(state.translationError, null);
  const result = sessionReducer(state, {
    type: "asr-turn",
    transcript: "之后交给 AI 的字幕。",
    endOfTurn: true,
    formatted: true,
  });
  assert.equal(result.state.pendingBatch.length, 1);
});
