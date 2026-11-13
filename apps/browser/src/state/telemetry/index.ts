import { devCrash } from "../../platform/dev";
import { onboardingCompletedAt } from "../onboarding/onboarding";
import { capture, devState, flush, setSharing, useTelemetry } from "./client";
import { requestLog } from "./requestLog";
import { devDaily, sendDailyPing, startDaily } from "./daily";
import { captureException, installErrorReporting, reportNativeCrashes } from "./errors";
import { devJourneys, emitJourneys } from "./journeys";
import { devOmniboxSampler } from "./track";
import { hardwareProperties, recordContext } from "./diagnostics";
import { devTabPresses } from "./tabPresses";
import { devHourly, sessionEnding, startUsage } from "./usage";
import { devLocalStore, exportLocalCopy, flushLocal, localEventsSince, pruneLocalStore } from "./localStore";
import { reportLocalStore } from "./localStoreReport";
import { checkWatch, startWatch, stopWatch, watchStatus } from "./watch";
import { startWatchNotice } from "./watchNotice";
import { reportIdentity, resetAnonymousId, telemetryIdentity } from "./identity";
import { diagnosticsText } from "./diagnosticsSnapshot";

export { installErrorReporting };
export { telemetryIdentity, reportIdentity, resetAnonymousId, type ReportIdentity, type TelemetryIdentity } from "./identity";
export { startWatch, stopWatch, watchStatus, WATCH_DAYS, type WatchStatus } from "./watch";
export { localEventsSince, exportLocalCopy } from "./localStore";
export { diagnosticsSnapshot, type DiagnosticsSnapshot } from "./diagnosticsSnapshot";

export function startTelemetry({ continuing = false }: { continuing?: boolean } = {}) {
  startUsage(continuing);
  startWatchNotice();
  startDaily(onboardingCompletedAt() !== null);
  if (__DEV__) {
    (globalThis as { acTelemetry?: unknown }).acTelemetry = {
      store: useTelemetry,
      state: devState,
      requests: requestLog,
      setSharing,
      flush,
      hourly: devHourly,
      daily: devDaily,
      sendDaily: () => sendDailyPing(),
      omniboxSampler: devOmniboxSampler,
      journeys: devJourneys,
      emitJourneys,
      quit: sessionEnding,
      reportNativeCrashes,
      recordContext,
      hardwareProperties,
      tabPresses: devTabPresses,
      captureException,
      capture,
      identity: telemetryIdentity,
      reportIdentity,
      resetAnonymousId,
      startWatch,
      stopWatch,
      checkWatch,
      watchStatus,
      local: devLocalStore,
      flushLocal,
      pruneLocal: pruneLocalStore,
      reportLocalStore,
      localEventsSince,
      exportLocalCopy,
      diagnosticsText,
      reportTestError: () =>
        captureException(
          new TypeError(`Telemetry test error reading /Users/someone/Library/secret.json for "Private Title" at https://private.example/page?q=1`),
          "onerror",
        ),
      rejectTestPromise: () => void Promise.reject(new RangeError("Telemetry test rejection at https://private.example/x")),
      crash: devCrash,
    };
  }
}
