import type { BrowserCommand } from "../../platform/commands";
import type { BrowserState } from "../browser/store";
import { automationCommands, automationDecision, isCatalogCommand, variantsOf } from "./automationCommands";
import { eligibleKind, lastFocusedEligibleWindow } from "./automationWindows";
import { AUTOMATION_EVENTS, type AutomationEventName } from "./automationEvents";

export const PROTOCOL = 1;

export type ErrorCode = "bad_request" | "unknown_method" | "unknown_command" | "refused" | "no_window" | "failed";
export type MethodError = { code: ErrorCode; message: string };
export type RequestId = number | string | null;
export type ParsedRequest = { id: RequestId; method: string; params: Record<string, unknown> };
export type RunPlan = { command: BrowserCommand; arg: string | null; windowId: string | null };
export type Subscription = ReadonlySet<AutomationEventName>;

export const failure = (code: ErrorCode, message: string) => ({ error: { code, message } satisfies MethodError });

const isFields = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRequest(line: string): ParsedRequest | { id: RequestId; error: MethodError } {
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    return { id: null, ...failure("bad_request", "The line isn't JSON.") };
  }
  if (!isFields(doc)) return { id: null, ...failure("bad_request", "A request is a JSON object.") };
  const id = doc.id;
  const usable = typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));
  if (!usable) return { id: null, ...failure("bad_request", "A request needs an id: a safe integer or a string.") };
  if (typeof doc.method !== "string") return { id, ...failure("bad_request", "A request needs a method.") };
  if (doc.params !== undefined && !isFields(doc.params)) return { id, ...failure("bad_request", "params must be an object.") };
  return { id, method: doc.method, params: (doc.params as Record<string, unknown> | undefined) ?? {} };
}

export const hello = (version: string) => ({ app: "Ardia", version, protocol: PROTOCOL });

export const commands = automationCommands;

const REFUSALS: Record<string, string> = {
  endsApp: "ends the app",
  changesEngine: "changes which engine shows a page",
  leftOutSetting: "changes a setting config files can't set",
  control: "touches control itself",
  needsArgument: "needs an argument the socket doesn't pass",
};

export function planRun(s: Pick<BrowserState, "windows" | "windowOrder" | "ui">, params: Record<string, unknown>): RunPlan | { error: MethodError } {
  const { command, arg, window } = params;
  if (typeof command !== "string" || !command) return failure("bad_request", "run needs a command id.");
  if (!isCatalogCommand(command)) return failure("unknown_command", `There's no command ${command}.`);
  const decision = automationDecision(command);
  if (decision !== "run") return failure("refused", `${command} ${REFUSALS[decision]}, so the ardia command can't run it.`);
  if (arg !== undefined && arg !== null) {
    const variants = variantsOf(command);
    if (typeof arg !== "string" || !variants?.includes(arg)) {
      return failure("bad_request", variants ? `${command} takes one of: ${variants.join(", ")}.` : `${command} takes no argument.`);
    }
  }
  if (window !== undefined && window !== null) {
    if (typeof window !== "string" || !eligibleKind(s, window)) return failure("no_window", `There's no window ${String(window)} the ardia command can use.`);
    return { command, arg: (arg as string | null | undefined) ?? null, windowId: window };
  }
  const target = lastFocusedEligibleWindow(s);
  if (target) return { command, arg: (arg as string | null | undefined) ?? null, windowId: target };
  if (s.windowOrder.length === 0) return { command, arg: (arg as string | null | undefined) ?? null, windowId: null };
  return failure("no_window", "No window the ardia command can use is open.");
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set(AUTOMATION_EVENTS);

export function parseSubscription(params: Record<string, unknown>): Subscription | { error: MethodError } {
  const { events } = params;
  if (!Array.isArray(events) || !events.every((name) => typeof name === "string")) return failure("bad_request", "subscribe needs events: a list of event names, or [\"*\"].");
  if (events.includes("*")) return new Set(AUTOMATION_EVENTS);
  const unknown = events.filter((name) => !KNOWN_EVENTS.has(name));
  if (unknown.length) return failure("bad_request", `Unknown events: ${unknown.join(", ")}. Events: ${AUTOMATION_EVENTS.join(", ")}.`);
  return new Set(events as AutomationEventName[]);
}
