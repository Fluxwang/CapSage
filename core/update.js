// 更新状态机（纯逻辑，不接触浏览器 API）。宿主只负责把事件喂进来，
// 再执行 reducer 返回的 I/O 指令。

const STABLE_VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CAPTURE_STATUSES = new Set(["capturing", "idle", "reconnecting"]);

function parseStableVersion(value) {
  if (typeof value !== "string") return null;
  const match = STABLE_VERSION.exec(value.trim());
  if (!match) return null;
  return match.slice(1).map((part) => Number(part ?? 0));
}

function hasAvailableUpdate(releasedVersion, runningVersion) {
  const released = parseStableVersion(releasedVersion);
  const running = parseStableVersion(runningVersion);
  if (!released || !running) return false;
  for (let index = 0; index < 3; index += 1) {
    if (released[index] !== running[index]) return released[index] > running[index];
  }
  return false;
}

function withView(state) {
  const availableUpdate = hasAvailableUpdate(state.releasedVersion, state.runningVersion);
  const checkButton = state.checkStatus === "checking"
    ? { label: "检查中", disabled: true }
    : availableUpdate
      ? { label: "发现新版本", disabled: true }
      : { label: "检查更新", disabled: false };
  const captureActive = ACTIVE_CAPTURE_STATUSES.has(state.captureStatus);
  return {
    ...state,
    view: {
      availableUpdate,
      runningVersion: state.runningVersion,
      releasedVersion: state.releasedVersion,
      releaseUrl: state.releaseUrl,
      checkButton,
      message: state.feedback?.message ?? null,
      messageTone: state.feedback?.tone ?? null,
      updateInstructions: availableUpdate
        ? {
            pull: "第 1 步：到仓库根目录双击 update.bat，完成拉取。",
            reload: "第 2 步：拉取完成后回到这里重载扩展，让磁盘上的新代码生效。",
            badge: "工具栏角标会在重载之后消失；只完成拉取时仍会显示。",
          }
        : null,
      reloadButton: {
        visible: availableUpdate,
        label: "我已拉取，重载扩展",
        disabled: !availableUpdate || captureActive,
        reason: captureActive
          ? "正在捕获；重载会中断捕获并丢失当前字幕。请先停止捕获。"
          : "重载会关闭当前设置页。",
      },
    },
  };
}

export function createUpdateState(persisted = {}) {
  return withView({
    releasedVersion: persisted.releasedVersion ?? null,
    releaseUrl: persisted.releaseUrl ?? null,
    lastCheckedAt: persisted.lastCheckedAt ?? null,
    runningVersion: null,
    captureStatus: "inactive",
    checkStatus: "idle",
    checkOrigin: null,
    feedback: null,
  });
}

export function updateReducer(state, event) {
  switch (event.type) {
    case "host-started": {
      let next = withView({
        ...state,
        runningVersion: event.runningVersion,
        captureStatus: event.captureStatus,
      });
      const stale = !Number.isFinite(next.lastCheckedAt)
        || event.now - next.lastCheckedAt > UPDATE_CHECK_INTERVAL_MS;
      const commands = [{ type: "set-badge", text: next.view.availableUpdate ? "•" : "" }];
      if (stale) {
        next = withView({ ...next, checkStatus: "checking", checkOrigin: "scheduled" });
        commands.push({ type: "fetch-release" });
      }
      return { state: next, commands };
    }

    case "alarm-fired":
      if (state.checkStatus === "checking") return { state, commands: [] };
      return {
        state: withView({
          ...state,
          checkStatus: "checking",
          checkOrigin: "scheduled",
          feedback: null,
        }),
        commands: [{ type: "fetch-release" }],
      };

    case "user-requested-check":
      if (state.checkStatus === "checking") {
        return state.checkOrigin === "scheduled"
          ? {
              state: withView({ ...state, checkOrigin: "user", feedback: null }),
              commands: [],
            }
          : { state, commands: [] };
      }
      return {
        state: withView({
          ...state,
          checkStatus: "checking",
          checkOrigin: "user",
          feedback: null,
        }),
        commands: [{ type: "fetch-release" }],
      };

    case "check-succeeded": {
      const fromUser = state.checkOrigin === "user";
      let next = withView({
        ...state,
        releasedVersion: event.releasedVersion,
        releaseUrl: event.releaseUrl,
        lastCheckedAt: event.now,
        checkStatus: "idle",
        checkOrigin: null,
        feedback: null,
      });
      if (fromUser) {
        next = withView({
          ...next,
          feedback: {
            message: next.view.availableUpdate ? "发现可用更新。" : "已是最新版本。",
            tone: "success",
          },
        });
      }
      return {
        state: next,
        commands: [
          {
            type: "persist",
            releasedVersion: event.releasedVersion,
            releaseUrl: event.releaseUrl,
            lastCheckedAt: event.now,
          },
          { type: "set-badge", text: next.view.availableUpdate ? "•" : "" },
        ],
      };
    }

    case "check-failed": {
      const feedback = state.checkOrigin === "user"
        ? { message: `检查失败：${event.reason}`, tone: "error" }
        : null;
      return {
        state: withView({
          ...state,
          checkStatus: "idle",
          checkOrigin: null,
          feedback,
        }),
        commands: [],
      };
    }

    case "capture-status-changed":
      return {
        state: withView({ ...state, captureStatus: event.captureStatus }),
        commands: [],
      };

    case "user-requested-reload":
      return state.view.reloadButton.visible && !state.view.reloadButton.disabled
        ? { state, commands: [{ type: "reload-extension" }] }
        : { state, commands: [] };

    default:
      return { state, commands: [] };
  }
}
