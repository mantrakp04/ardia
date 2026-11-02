import { devCrash } from "../../platform/dev";
import { onboardingCompletedAt } from "../onboarding/onboarding";
import { devState, flush, setSharing, useTelemetry } from "./client";
import { requestLog } from "./requestLog";
import { devDaily, sendDailyPing, startDaily } from "./daily";
import { captureException, installErrorReporting, reportNativeCrashes } from "./errors";
import { devJourneys, emitJourneys } from "./journeys";
import { devOmniboxSampler } from "./track";
import { devHourly, sessionEnding, startUsage } from "./usage";

export { installErrorReporting };

export function startTelemetry() {
  startUsage();
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
      captureException,
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
