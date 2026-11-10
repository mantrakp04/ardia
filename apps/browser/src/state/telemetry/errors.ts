import { crashReports } from "../../platform/app";
import { advanceCrashCursor, capture, crashCursor, loadChoice, saveQueueNow } from "./client";
import { contextAt, contextProperties, sessionStart } from "./diagnostics";
import type { SavedContext } from "./savedContext";
import { recordLog } from "./logs";
import { errorCode, errorMessage, errorType, nativeCrashExceptions, nativeCrashTermination, parseStack, type ExceptionFrame } from "./sanitize";

type Mechanism = "onerror" | "onunhandledrejection" | "react" | "console" | "native_crash" | "helper_crash";

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
    if (!isFatal) return original.call(manager, error, isFatal);
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
    if (isFatal && !fatalReportsHeld) void saveQueueNow().then(() => previous?.(error, isFatal));
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

const VERSION = /^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/;
const BUILD = /^[\w.-]{1,32}$/;
const ENGINE_VERSION = /^\d+(?:\.\d+){1,3}$/;
const optional = (value: string | undefined, pattern: RegExp) => (value && pattern.test(value) ? value : null);
const whole = (value: number | undefined) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

export async function reportNativeCrashes(contexts: (SavedContext | null)[] = []) {
  const since = crashCursor();
  const reports = await crashReports(since).catch(() => []);
  let latest = since;
  for (const report of reports) {
    latest = Math.max(latest, report.fileTime ?? report.time);
    const browser = report.process === "browser";
    const mechanism: Mechanism = browser ? "native_crash" : "helper_crash";
    const { name, signal, subtype, images, exceptions } = nativeCrashExceptions(report);
    const context = contextAt(contexts, report.time, [sessionStart()]);
    capture(
      "$exception",
      {
        $exception_level: "fatal",
        source: mechanism,
        crash_process: report.process,
        crash_signal: signal,
        crash_subtype: subtype,
        crash_termination: nativeCrashTermination(report.terminationNamespace),
        objc_exception: name,
        crashed_minutes_ago: Math.round((Date.now() - report.time) / 60_000),
        crashed_version: browser ? optional(report.appVersion, VERSION) : null,
        crashed_build: browser ? optional(report.build, BUILD) : null,
        crashed_engine_version: browser ? null : optional(report.engineVersion, ENGINE_VERSION),
        crash_uptime_s: whole(report.uptimeSeconds),
        crash_vm_writable_mb: whole(report.vmWritableMB),
        ...contextProperties(context, "ctx_", report.time),
      },
      {
        urgent: true,
        persist: true,
        raw: { ...exceptionProperties(exceptions, mechanism, false), crash_images: images },
      },
    );
  }
  advanceCrashCursor(latest);
}
