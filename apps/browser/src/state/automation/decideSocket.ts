import { broadcastOnControlSocket } from "../../platform/automation";
import { isFields } from "../../lib/decode";
import { parseHooksDocument, type HookSpec } from "./hookFile";
import { hookNamed } from "./hookRules";

export const MAX_PENDING_DECISIONS = 64;
export const MAX_PENDING_PER_CONNECTION = 16;
export const MAX_SERVED_HOOKS = 100;

type Responder = { connection: number; served: Map<string, string> };
type Pending = { id: string; connection: number; settle: (answer: unknown) => void };

const responders = new Map<number, Responder>();
const pending = new Map<string, Pending>();
const servedListeners = new Set<() => void>();
let seq = 0;

export const onServedHooksChanged = (listener: () => void) => {
  servedListeners.add(listener);
  return () => void servedListeners.delete(listener);
};

const notifyServed = () => {
  for (const listener of servedListeners) listener();
};

export function serveHooks(connection: number, raws: unknown): { served: string[] } | { error: string } {
  if (raws === undefined || raws === null) {
    if (responders.delete(connection)) notifyServed();
    return { served: [] };
  }
  if (!Array.isArray(raws) || raws.length > MAX_SERVED_HOOKS) return { error: `hooks must be a list of at most ${MAX_SERVED_HOOKS} hooks from hooks.json` };
  const parsed = parseHooksDocument({ hooks: raws });
  if (parsed.problems.length) return { error: parsed.problems.join("; ") };
  const served = new Map<string, string>();
  for (const hook of parsed.hooks) {
    if (!hook.program || (!hook.decide && !hook.omnibox)) continue;
    if (hookNamed(hook.name, hook.revision)) served.set(hook.name, hook.revision);
  }
  for (const other of responders.values()) {
    if (other.connection === connection) continue;
    for (const [name, revision] of served) if (other.served.get(name) === revision) served.delete(name);
  }
  responders.set(connection, { connection, served });
  notifyServed();
  return { served: [...served.keys()] };
}

export function servingConnection(hook: HookSpec): number | null {
  for (const r of responders.values()) if (r.served.get(hook.name) === hook.revision) return r.connection;
  return null;
}

export const servedHooks = (): { connection: number; name: string; revision: string }[] =>
  [...responders.values()].flatMap((r) => [...r.served].map(([name, revision]) => ({ connection: r.connection, name, revision })));

function send(connection: number, line: object) {
  try {
    broadcastOnControlSocket([connection], JSON.stringify(line));
  } catch (error) {
    console.warn("[automation] couldn't send a decide request", error);
  }
}

export function requestDecision(hook: HookSpec, event: string, data: Record<string, unknown>, deadlineMs: number, signal?: AbortSignal): Promise<unknown> {
  const connection = servingConnection(hook);
  if (connection === null || pending.size >= MAX_PENDING_DECISIONS || signal?.aborted) return Promise.resolve(undefined);
  let mine = 0;
  for (const p of pending.values()) if (p.connection === connection) mine += 1;
  if (mine >= MAX_PENDING_PER_CONNECTION) return Promise.resolve(undefined);
  const id = `d${++seq}`;
  return new Promise((resolve) => {
    const finish = (answer: unknown, cancelled: boolean) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (cancelled) send(connection, { decide: id, cancel: true });
      resolve(answer);
    };
    const onAbort = () => finish(undefined, true);
    const timer = setTimeout(() => finish(undefined, true), deadlineMs);
    signal?.addEventListener("abort", onAbort);
    pending.set(id, { id, connection, settle: (answer) => finish(answer, false) });
    send(connection, { decide: id, event, hook: hook.name, revision: hook.revision, deadline: deadlineMs, time: Date.now(), data });
  });
}

export function answerDecision(connection: number, params: Record<string, unknown>): { ok: true } | { error: string } {
  const id = params.decide;
  if (typeof id !== "string") return { error: "answer needs decide: the request's id" };
  const entry = pending.get(id);
  if (!entry || entry.connection !== connection) return { error: `${id} isn't waiting for an answer from this connection (late, answered or someone else's)` };
  const answer = params.answer;
  const usable = answer === null || answer === undefined || isFields(answer) || Array.isArray(answer);
  entry.settle(usable ? (answer ?? null) : undefined);
  if (!usable) return { error: "answer must be an object, a list or null; Ardia used its default" };
  return { ok: true };
}

export function dropResponder(connection: number) {
  for (const p of [...pending.values()]) if (p.connection === connection) p.settle(undefined);
  if (responders.delete(connection)) notifyServed();
}

export function cancelAllDecisions() {
  for (const p of [...pending.values()]) p.settle(undefined);
}

export function stopResponders() {
  cancelAllDecisions();
  if (responders.size) {
    responders.clear();
    notifyServed();
  }
}

export const pendingDecisionCount = () => pending.size;
