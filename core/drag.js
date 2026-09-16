// 核心模块 —— 字幕浮层拖动几何（纯逻辑，不接触任何浏览器 API）
//
// 交互模型：按住字幕框满 HOLD_MS 才进入拖动（防止快速点击/滚动误触发）；
// 按住期间指针移动超过 MOVE_SLOP_PX 视为用户在滚动/划过，取消长按。
// 拖动位置以 clamp 保持在视口内——拖不丢才拖得回来。

// 长按激活拖动的阈值（毫秒）
export const HOLD_MS = 1000;
// 按住期间允许的最大位移（像素），超过则取消长按
export const MOVE_SLOP_PX = 5;
// 拖动 clamp 后字幕框每侧至少留在视口内的像素数——全拖出去就找不回了
export const VISIBLE_EDGE_PX = 60;

// 按住期间的指针位移是否超出容差（true = 用户意图不是长按，取消）
export function isBeyondSlop(startX, startY, x, y) {
  const dx = x - startX;
  const dy = y - startY;
  return dx * dx + dy * dy > MOVE_SLOP_PX * MOVE_SLOP_PX;
}

// 由拖动起点矩形 + 指针累计位移计算新的 left/top，并 clamp 进视口。
// startRect 取拖动开始时 getBoundingClientRect() 的 {left, top, width, height}。
export function applyDrag(startRect, dx, dy, viewportW, viewportH) {
  const left = clamp(
    startRect.left + dx,
    VISIBLE_EDGE_PX - startRect.width,
    viewportW - VISIBLE_EDGE_PX
  );
  const top = clamp(
    startRect.top + dy,
    0,
    viewportH - VISIBLE_EDGE_PX
  );
  return { left, top };
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
