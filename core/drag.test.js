// core/drag.js 的单元测试（node --test，无浏览器）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLD_MS,
  MOVE_SLOP_PX,
  VISIBLE_EDGE_PX,
  isBeyondSlop,
  applyDrag,
} from "./drag.js";

// ---- 常量钉死：改这些值等于改交互手感，测试让改动显式化 ----

test("交互阈值常量", () => {
  assert.equal(HOLD_MS, 1000);
  assert.equal(MOVE_SLOP_PX, 5);
  assert.equal(VISIBLE_EDGE_PX, 60);
});

// ---- isBeyondSlop：容差判定 ----

test("位移在容差内不算超出", () => {
  assert.equal(isBeyondSlop(100, 100, 103, 104), false); // 距离 5，未超过
  assert.equal(isBeyondSlop(100, 100, 100, 100), false); // 原地
});

test("位移超过容差算超出", () => {
  assert.equal(isBeyondSlop(100, 100, 106, 100), true); // x +6
  assert.equal(isBeyondSlop(100, 100, 100, 106), true); // y +6
  assert.equal(isBeyondSlop(100, 100, 96, 96), true); // 反向 -4,-4 → 距离 ~5.66
});

// ---- applyDrag：位移 + clamp ----

const RECT = { left: 300, top: 500, width: 400, height: 120 };
const VIEW = { w: 1920, h: 1080 };

test("常规位移原样叠加", () => {
  const { left, top } = applyDrag(RECT, 100, -200, VIEW.w, VIEW.h);
  assert.equal(left, 400);
  assert.equal(top, 300);
});

test("负位移（往左上拖）不受 clamp 干扰", () => {
  const { left, top } = applyDrag(RECT, -50, -30, VIEW.w, VIEW.h);
  assert.equal(left, 250);
  assert.equal(top, 470);
});

test("左边界：框至少留 60px 在视口内（不能整个拖出左边）", () => {
  const { left } = applyDrag(RECT, -1000, 0, VIEW.w, VIEW.h);
  assert.equal(left, VISIBLE_EDGE_PX - RECT.width); // 60 - 400 = -340
});

test("右边界：框右缘至少到视口右缘往左 60px", () => {
  const { left } = applyDrag(RECT, 5000, 0, VIEW.w, VIEW.h);
  assert.equal(left, VIEW.w - VISIBLE_EDGE_PX); // 1860
});

test("上边界：顶不能为负", () => {
  const { top } = applyDrag(RECT, 0, -1000, VIEW.w, VIEW.h);
  assert.equal(top, 0);
});

test("下边界：底部至少留 60px 在视口内", () => {
  const { top } = applyDrag(RECT, 0, 5000, VIEW.w, VIEW.h);
  assert.equal(top, VIEW.h - VISIBLE_EDGE_PX); // 1020
});

test("框比视口宽时左右 clamp 区间不倒挂（min > max 时取 min 侧）", () => {
  // 200px 宽的框塞不进 60px 边距的窄视口：clamp 区间为空，
  // 至少不能抛错或返回 NaN，且结果落在两侧约束之间任一侧。
  const narrowRect = { left: 0, top: 0, width: 500, height: 100 };
  const { left } = applyDrag(narrowRect, 0, 0, 300, 600);
  assert.ok(Number.isFinite(left));
});
