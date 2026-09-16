// 视频播放进度的纯逻辑。content script 只采样 video.currentTime；一轮播放
// 是否结束、哪个字幕 cue 正在播放都在这里判断，因此侧边栏和悬浮层可以
// 复用同一套时间语义。

const END_WINDOW_SECONDS = 1.25;
const START_WINDOW_SECONDS = 1.25;
const NATURAL_PROGRESS_MAX_SECONDS = 2.5;
const END_LEAD_IN_SECONDS = 4;

export function createPlaybackState() {
  return {
    lastTime: null,
    duration: null,
    armedForLoop: false,
    naturalProgressSamples: 0,
    completedOnePlaythrough: false,
  };
}

// 输入连续的 timeupdate / 轮询采样。只有自然播放已经接近结尾、随后回到
// 起点才算一轮完成；直接拖到末尾再拖回开头不会触发，暂停也不会武装检测器。
export function samplePlayback(state, sample) {
  const currentTime = Number(sample?.currentTime);
  const duration = Number(sample?.duration);
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return { state, completedOnePlaythrough: false };
  }
  if (state.completedOnePlaythrough) {
    return {
      state: { ...state, lastTime: currentTime, duration },
      completedOnePlaythrough: false,
    };
  }
  if (sample?.paused) {
    return {
      state: {
        ...state,
        lastTime: currentTime,
        duration,
        armedForLoop: false,
        naturalProgressSamples: 0,
      },
      completedOnePlaythrough: false,
    };
  }

  const sameDuration = state.duration === null || Math.abs(state.duration - duration) < 0.01;
  const previous = state.lastTime;
  const naturalAdvance = previous === null ? null : currentTime - previous;
  const naturalProgress =
    sameDuration &&
    naturalAdvance !== null &&
    naturalAdvance >= 0 &&
    naturalAdvance <= NATURAL_PROGRESS_MAX_SECONDS;
  const naturalProgressSamples = naturalProgress
    ? (state.naturalProgressSamples ?? 0) + 1
    : 0;
  const nearEnd = currentTime >= duration - END_WINDOW_SECONDS;
  const previousNearEnd = previous !== null && previous >= duration - END_WINDOW_SECONDS;
  const naturalLeadIn =
    sameDuration &&
    nearEnd &&
    previous !== null &&
    previous >= duration - END_LEAD_IN_SECONDS &&
    naturalProgressSamples >= 2;
  const loopedBack =
    sameDuration &&
    state.armedForLoop &&
    previousNearEnd &&
    currentTime <= START_WINDOW_SECONDS &&
    previous - currentTime > END_WINDOW_SECONDS;
  const completedOnePlaythrough = Boolean(loopedBack);

  return {
    state: {
      ...state,
      lastTime: currentTime,
      duration,
      armedForLoop: completedOnePlaythrough ? false : state.armedForLoop || naturalLeadIn,
      naturalProgressSamples,
      completedOnePlaythrough: state.completedOnePlaythrough || completedOnePlaythrough,
    },
    completedOnePlaythrough,
  };
}

export function activeCueIndex(cues, currentTime) {
  const time = Number(currentTime);
  if (!Number.isFinite(time)) return -1;
  return (cues ?? []).findIndex((cue) =>
    Number.isFinite(cue?.startSeconds) &&
    Number.isFinite(cue?.endSeconds) &&
    time >= cue.startSeconds && time < cue.endSeconds
  );
}
