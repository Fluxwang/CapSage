// 核心模块 —— 音频转换（纯逻辑，不接触任何浏览器 API）
//
// 这里是整个扩展唯一的测试接缝：所有「错了不报错、只是悄悄降低识别率」
// 的音频数值处理都收拢在此，用单元测试钉死。

// Convert RMS amplitude to a stable UI level. Keeping this pure makes the
// low-level meter behavior testable without requiring a real captured tab.
// Maps -60 dBFS to 0% so quiet-but-real signals stay visible.
export function rmsToVolumePercent(rms) {
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  return Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
}

// ---- 音频块（Chunk）几何 ----
//
// AudioWorklet 每个 process() 回调收到一个 render quantum（128 帧）。
// 协议要求每条 WebSocket 消息承载 50–1000ms 的音频；16kHz 下取
// 8 个 quantum = 1024 样本 = 64ms，安全落在区间内。选 8 是因为它整除，
// 不需要处理跨 quantum 的部分拷贝。实测发现话轮检测抖动时，
// 只调 QUANTA_PER_CHUNK 这一个具名常量即可。
export const RENDER_QUANTUM = 128;
export const QUANTA_PER_CHUNK = 8;
export const CHUNK_SAMPLES = RENDER_QUANTUM * QUANTA_PER_CHUNK;
// 一个音频块承载的音频时长（16kHz 下 1024 样本 = 64ms）。
// 静音计时与重连预缓冲都以块为时间单位。
export const CHUNK_MS = 64;

const INT16_MAX = 32767;
const INT16_MIN = -32768;

// Float32 多声道 → Int16 单声道。
// 降混必须对所有声道求平均（不能只取声道 0——人声可能偏在另一侧）；
// 转换前必须夹逼到 [-1, 1]（不夹逼会在混音超出 ±1.0 时整数回绕，
// 产生刺耳失真，而音量表完全看不出来）。
export function toInt16Mono(channels) {
  const numChannels = channels.length;
  const length = channels[0].length;
  const out = new Int16Array(length);

  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < numChannels; c++) {
      sum += channels[c][i];
    }
    const avg = sum / numChannels;
    const clamped = avg > 1 ? 1 : avg < -1 ? -1 : avg;
    out[i] = clamped >= 0 ? Math.round(clamped * INT16_MAX) : Math.round(clamped * -INT16_MIN);
  }

  return out;
}

// Int16 音频块的 RMS。音量表显示与静音检测（ticket 08）共用同一个值，
// worklet 逐块产出、宿主不需要再算第二遍。
export function rmsOfInt16Chunk(chunk) {
  let sumSquares = 0;
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i] / -INT16_MIN;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / chunk.length);
}

// 攒满 QUANTA_PER_CHUNK 个 quantum 产出一个音频块，其余时候返回 null。
export function createChunkAccumulator() {
  let pendingChunk = new Int16Array(CHUNK_SAMPLES);
  let filled = 0;

  return {
    push(int16Quantum) {
      pendingChunk.set(int16Quantum, filled * RENDER_QUANTUM);
      filled += 1;
      if (filled < QUANTA_PER_CHUNK) return null;

      const chunk = pendingChunk;
      pendingChunk = new Int16Array(CHUNK_SAMPLES);
      filled = 0;
      return chunk;
    },

    // 返回尚未攒满的残余样本（转写链路停止时冲刷用）
    reset() {
      const leftover = pendingChunk.slice(0, filled * RENDER_QUANTUM);
      pendingChunk = new Int16Array(CHUNK_SAMPLES);
      filled = 0;
      return leftover;
    },
  };
}
