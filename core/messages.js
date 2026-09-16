// 会话终止原因的用户文案（offscreen 与 popup 共享；content script 不能
// import ESM 模块，它在自己的文件里持有一份渲染层副本）。
// 文案原则（ADR-0002/0005）：到限提示要明确说「可以重新开始」，
// 这点摩擦是故意的——花钱有上限。
export const sessionEndMessages = {
  "session-cap": "⏰ 已达单次会话上限（1 小时），连接已结束。想继续看请再点一次「开始」。",
  "audio-ended": "📡 音频已结束（标签页关闭或直播断流），捕获已自动停止。",
  "auth-error": "🔑 转写服务拒绝了请求：Key 无效、余额耗尽或会话到限。请到设置页检查 Key 与账户余额。",
  "reconnect-exhausted": "🌐 多次重连仍失败，已停止（不再自动重试）。网络恢复后可重新点「开始」。",
  "capture-failed": "❌ 捕获失败，会话已结束。",
  "user-stop": "⏹ 已停止捕获。",
  "video-playthrough": "▶️ 视频已播放完一轮，转写已自动停止。",
};
