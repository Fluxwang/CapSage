// 转写链路的 AudioWorklet —— 在 16kHz AudioContext 里跑（ADR-0001）
//
// 每个 process() 收到一个 render quantum（128 帧），交给核心模块降混转
// Int16 并累积；攒满 8 个产出一个音频块，连同它的 RMS 发回主线程。
// 数值逻辑全部来自 core/audio.js——那里是唯一被单元测试钉死的接缝。
//
// 注意：本处理器必须串在一条通向 destination 的路径上（宿主在后面接了
// 一个 gain(0)）。Web Audio 是拉取模型，死胡同节点永远不会被驱动。
import {
  RENDER_QUANTUM,
  toInt16Mono,
  createChunkAccumulator,
  rmsOfInt16Chunk,
} from "./core/audio.js";

class AsrChunkerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = createChunkAccumulator();
  }

  process(inputs) {
    const channels = inputs[0];
    // 输入还没接上（或暂时没有音频）时保持存活，等下一个 quantum
    if (channels && channels.length > 0 && channels[0].length === RENDER_QUANTUM) {
      const chunk = this.acc.push(toInt16Mono(channels));
      if (chunk) {
        this.port.postMessage({ chunk, rms: rmsOfInt16Chunk(chunk) });
      }
    }
    // 输出保持静音即可——这条路径存在的意义是驱动本处理器，不是发声
    return true;
  }
}

registerProcessor("asr-chunker", AsrChunkerProcessor);
