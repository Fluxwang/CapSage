(() => {
  // core/audio.js
  var RENDER_QUANTUM = 128;
  var QUANTA_PER_CHUNK = 8;
  var CHUNK_SAMPLES = RENDER_QUANTUM * QUANTA_PER_CHUNK;
  var INT16_MAX = 32767;
  var INT16_MIN = -32768;
  function toInt16Mono(channels) {
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
  function rmsOfInt16Chunk(chunk) {
    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i] / -INT16_MIN;
      sumSquares += v * v;
    }
    return Math.sqrt(sumSquares / chunk.length);
  }
  function createChunkAccumulator() {
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
      }
    };
  }

  // asr-worklet.js
  var AsrChunkerProcessor = class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.acc = createChunkAccumulator();
    }
    process(inputs) {
      const channels = inputs[0];
      if (channels && channels.length > 0 && channels[0].length === RENDER_QUANTUM) {
        const chunk = this.acc.push(toInt16Mono(channels));
        if (chunk) {
          this.port.postMessage({ chunk, rms: rmsOfInt16Chunk(chunk) });
        }
      }
      return true;
    }
  };
  registerProcessor("asr-chunker", AsrChunkerProcessor);
})();
