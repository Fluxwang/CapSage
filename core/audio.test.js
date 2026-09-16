import assert from "node:assert/strict";
import test from "node:test";

import {
  rmsToVolumePercent,
  rmsOfInt16Chunk,
  RENDER_QUANTUM,
  QUANTA_PER_CHUNK,
  CHUNK_SAMPLES,
  toInt16Mono,
  createChunkAccumulator,
} from "./audio.js";

test("volume meter keeps quiet audible signals visible", () => {
  assert.equal(rmsToVolumePercent(0), 0);
  assert.ok(rmsToVolumePercent(0.003) > 0);
  assert.ok(rmsToVolumePercent(0.003) < 50);
  assert.equal(rmsToVolumePercent(1), 100);
});

test("chunk size is the named constant: 8 render quanta of 128 samples", () => {
  assert.equal(RENDER_QUANTUM, 128);
  assert.equal(QUANTA_PER_CHUNK, 8);
  assert.equal(CHUNK_SAMPLES, RENDER_QUANTUM * QUANTA_PER_CHUNK);
  assert.equal(CHUNK_SAMPLES, 1024);
});

test("downmix averages all channels instead of taking channel 0", () => {
  // 人声可能偏在右声道：只取声道 0 会丢掉一半内容
  const left = new Float32Array([0, 0, 0, 0]);
  const right = new Float32Array([1, 1, 0.5, -0.5]);
  const out = toInt16Mono([left, right]);
  assert.deepEqual(Array.from(out), [16384, 16384, 8192, -8192]);
});

test("samples beyond [-1, 1] are clamped, never wrap around", () => {
  // 不夹逼会在混音超出范围时整数回绕，产生刺耳失真且音量表看不出来
  const hot = new Float32Array([2.0, 1.5, -1.5, -2.0, 1.0, -1.0]);
  const out = toInt16Mono([hot]);
  assert.deepEqual(Array.from(out), [32767, 32767, -32768, -32768, 32767, -32768]);
});

test("silent input produces silent output", () => {
  const out = toInt16Mono([new Float32Array(128)]);
  assert.equal(out.length, 128);
  assert.ok(Array.from(out).every((s) => s === 0));
});

test("mono input passes through scaled, stereo of identical channels is unchanged", () => {
  const mono = new Float32Array([0.5, -0.25]);
  assert.deepEqual(Array.from(toInt16Mono([mono])), [16384, -8192]);

  const l = new Float32Array([0.5, -0.25]);
  const r = new Float32Array([0.5, -0.25]);
  assert.deepEqual(Array.from(toInt16Mono([l, r])), [16384, -8192]);
});

test("rmsOfInt16Chunk matches the float-domain RMS of the same signal", () => {
  const chunk = toInt16Mono([new Float32Array(1024).fill(0.5)]);
  assert.ok(Math.abs(rmsOfInt16Chunk(chunk) - 0.5) < 0.001);
  assert.equal(rmsOfInt16Chunk(new Int16Array(1024)), 0);
});

test("accumulator emits nothing until 8 quanta, then emits a 1024-sample chunk", () => {
  const acc = createChunkAccumulator();
  const quantum = toInt16Mono([new Float32Array(RENDER_QUANTUM).fill(0.25)]);

  for (let i = 1; i < QUANTA_PER_CHUNK; i++) {
    assert.equal(acc.push(quantum), null, `push ${i} should not emit`);
  }
  const chunk = acc.push(quantum);
  assert.notEqual(chunk, null);
  assert.equal(chunk.length, CHUNK_SAMPLES);
  assert.ok(Array.from(chunk).every((s) => s === 8192));
});

test("accumulator keeps accumulating across emitted chunks", () => {
  const acc = createChunkAccumulator();
  const quantum = toInt16Mono([new Float32Array(RENDER_QUANTUM).fill(0.5)]);

  for (let i = 0; i < QUANTA_PER_CHUNK; i++) acc.push(quantum);
  for (let i = 1; i < QUANTA_PER_CHUNK; i++) {
    assert.equal(acc.push(quantum), null);
  }
  const second = acc.push(quantum);
  assert.notEqual(second, null);
  assert.equal(second.length, CHUNK_SAMPLES);
});

test("accumulator flushes any leftover samples on reset", () => {
  const acc = createChunkAccumulator();
  const quantum = toInt16Mono([new Float32Array(RENDER_QUANTUM).fill(0.5)]);
  for (let i = 0; i < 3; i++) acc.push(quantum);

  const leftover = acc.reset();
  assert.equal(leftover.length, 3 * RENDER_QUANTUM);
  assert.equal(acc.reset().length, 0);
});
