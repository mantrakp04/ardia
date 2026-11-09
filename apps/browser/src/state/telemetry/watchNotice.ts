import { useBrowser } from "../browser/store";
import { focusedWindowId } from "../browser/current";
import { showToast } from "../app/toasts";
import { openSettings } from "../settings/settingsWindows";
import { useTelemetry } from "./choice";
import { pendingWatchNotice, watchNoticeShown } from "./watch";
import { WATCH_COPY } from "./copy";

let unsubscribe: (() => void) | undefined;

function showWhenWindowOpen() {
  const report = pendingWatchNotice();
  if (!report) return true;
  const windowId = focusedWindowId();
  if (!windowId) return false;
  showToast(windowId, WATCH_COPY.endedTitle, WATCH_COPY.endedMessage(report), {
    icon: "checkmark.shield",
    key: "watch-ended",
    action: { title: WATCH_COPY.endedAction, run: () => openSettings("privacy") },
  });
  watchNoticeShown();
  return true;
}

function tryShow() {
  if (!showWhenWindowOpen()) return;
  unsubscribe?.();
  unsubscribe = undefined;
}

export function startWatchNotice() {
  useTelemetry.subscribe(() => {
    if (pendingWatchNotice() && !unsubscribe) {
      unsubscribe = useBrowser.subscribe(tryShow);
      tryShow();
    }
  });
  if (pendingWatchNotice()) {
    unsubscribe = useBrowser.subscribe(tryShow);
    tryShow();
  }
}
