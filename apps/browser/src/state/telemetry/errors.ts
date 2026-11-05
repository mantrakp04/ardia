import { crashReports, systemInfo } from "../../platform/app";
import { advanceCrashCursor, capture, crashCursor, isSharing, loadChoice, saveQueueNow } from "./client";
import { recordLog } from "./logs";
import { errorCode, errorMessage, errorType, nativeCrashExceptions, parseStack, type ExceptionFrame } from "./sanitize";

type Mechanism = "onerror" | "onunhandledrejection" | "react" | "console" | "native_crash";

const MAX_PER_SESSION = 25;
const reported = new WeakSet<object>();
const seen = new Set<string>();

type ExceptionEntry = { type: string; value: string; frames: ExceptionFrame[] };

function exceptionProperties(entries: ExceptionEntry[], mechanism: Mechanism, handled: boolean) {
  return {
    $exception_types: entries.map((e) => e.type),
    $exception_values: entries.map((e) => e.value),
    $exception_list: entries.map(({ type, value, frames }) => ({
      type,
      value,
      mechanism: { type: mechanism, handled, synthetic: false },
      stacktrace: { type: "raw", frames },
    })),
  };
}

export function captureException(error: unknown, mechanism: Mechanism, { fatal = false, handled = false } = {}) {
  if (!isSharing()) return;
  try {
    if (error && typeof error === "object") {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const type = errorType(error);
    const value = errorMessage(error) || type;
    const frames = parseStack(error && typeof error === "object" ? (error as { stack?: unknown }).stack : undefined);
    const code = errorCode(error);
    const key = `${type}|${value}|${code ?? ""}|${frames.at(-1)?.function ?? ""}`;
    if (seen.has(key) || seen.size >= MAX_PER_SESSION) return;
    seen.add(key);
    capture(
      "$exception",
      { $exception_level: fatal ? "fatal" : "error", source: mechanism, error_code: code },
      { urgent: true, persist: true, raw: exceptionProperties([{ type, value, frames }], mechanism, handled) },
    );
  } catch {}
}

type ErrorUtilsType = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};
type HermesInternalType = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

type ExceptionsManagerType = { handleException?: (error: unknown, isFatal: boolean) => void };

function reactNativeExceptionsManager(): ExceptionsManagerType | null {
  try {
    return require("react-native/Libraries/Core/ExceptionsManager").default ?? null;
  } catch {
    return null;
  }
}

export function holdFatalReports(manager: ExceptionsManagerType | null): boolean {
  const original = manager?.handleException;
  if (!manager || typeof original !== "function") return false;
  manager.handleException = (error, isFatal) => {
    if (!isFatal || !isSharing()) return original.call(manager, error, isFatal);
    const mechanism = (error as { isComponentError?: boolean } | null)?.isComponentError ? "react" : "onerror";
    captureException(error, mechanism, { fatal: true });
    void saveQueueNow().then(() => original.call(manager, error, isFatal));
  };
  return true;
}

let installed = false;

export function installErrorReporting() {
  if (installed) return;
  installed = true;
  loadChoice();
  const g = globalThis as { ErrorUtils?: ErrorUtilsType; HermesInternal?: HermesInternalType };

  const fatalReportsHeld = holdFatalReports(reactNativeExceptionsManager());
  const previous = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    captureException(error, "onerror", { fatal: !!isFatal });
    if (isFatal && isSharing() && !fatalReportsHeld) void saveQueueNow().then(() => previous?.(error, isFatal));
    else previous?.(error, isFatal);
  });

  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id, rejection) => {
      captureException(rejection, "onunhandledrejection");
      if (__DEV__) console.warn(`Possible unhandled promise rejection (id: ${id})`, rejection);
    },
    onHandled: () => {},
  });

  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    let busy = false;
    console[level] = (...args: unknown[]) => {
      if (!busy) {
        busy = true;
        try {
          const first = args[0];
          if (level === "error" && first instanceof Error) {
            captureException(first, (first as { isComponentError?: boolean }).isComponentError ? "react" : "console");
          } else recordLog(level, args);
        } catch {}
        busy = false;
      }
      original.apply(console, args);
    };
  }
}

export async function reportNativeCrashes() {
  if (!isSharing()) return;
  const since = crashCursor();
  const reports = await crashReports(since).catch(() => []);
  const version = systemInfo().appVersion;
  let latest = since;
  for (const report of reports) {
    latest = Math.max(latest, report.time);
    if (report.appVersion && report.appVersion !== version) continue;
    const { name, signal, subtype, images, exceptions } = nativeCrashExceptions(report);
    capture(
      "$exception",
      {
        $exception_level: "fatal",
        source: "native_crash",
        crash_signal: signal,
        crash_subtype: subtype,
        objc_exception: name,
        crashed_minutes_ago: Math.round((Date.now() - report.time) / 60_000),
      },
      {
        urgent: true,
        persist: true,
        raw: { ...exceptionProperties(exceptions, "native_crash", false), crash_images: images },
      },
    );
  }
  advanceCrashCursor(latest);
}
