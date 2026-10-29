type InputTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type ModuleProvider = (name: string, method: string) => unknown;

const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

export const TAB_POLICY_LOCK = "ardia.linux.tab-policies";
export const TAB_POLICY_CHANNEL = "ardia.linux.tab-policies";
export const BATTERY_SAVER_WAIT_MS = 2_000;

export function watchInputIdle(target: InputTarget, now: () => number = Date.now) {
  let last = now();
  const touch = () => { last = now(); };
  for (const type of INPUT_EVENTS) target.addEventListener(type, touch, { capture: true, passive: true });
  return {
    seconds: () => Math.max(0, (now() - last) / 1000),
    note: touch,
    stop: () => { for (const type of INPUT_EVENTS) target.removeEventListener(type, touch, { capture: true }); },
  };
}

type EngineEvents = { addListener(event: string, listener: (payload: unknown) => void): { remove(): void } };

export function watchHostInputActivity(engine: EngineEvents, listener: () => void): () => void {
  const subscription = engine.addListener("engine", (payload) => {
    if ((payload as { name?: unknown } | null)?.name === "engine.inputActivity") listener();
  });
  return () => subscription.remove();
}

export type PolicyLocks = { request(name: string, callback: () => Promise<void>): Promise<unknown> };
export type PolicyChannel = { postMessage(message: unknown): void; addEventListener(type: "message", listener: (event: { data: unknown }) => void): void; close(): void };

export type LinuxPolicyDeps = {
  target: InputTarget;
  provide: (provider: ModuleProvider) => () => void;
  startLifecycle: () => void;
  startTrim: () => void;
  now?: () => number;
  windowId?: string;
  activity?: (listener: () => void) => () => void;
  locks?: PolicyLocks;
  channel?: PolicyChannel;
  privateWindow?: boolean;
};

type SaverReply = { mode: string; reply: unknown };

let running: (() => void) | null = null;
let owner = false;
let ownWindow: string | undefined;
let channel: PolicyChannel | null = null;
let ownerReply: SaverReply | null = null;
let saverGeneration = 0;
let latestSaver: Promise<unknown> | null = null;
const replyWaiters = new Set<(reply: SaverReply) => void>();

export const isTabPolicyOwner = () => owner;

export function startLinuxTabPolicies(deps: LinuxPolicyDeps): () => void {
  if (running) return running;
  const idle = watchInputIdle(deps.target, deps.now);
  const unprovide = deps.provide((name, method) => name === "ArdiaEngine" && method === "inputIdleSeconds" ? () => idle.seconds() : undefined);
  const unwatch = deps.activity?.(idle.note) ?? (() => {});
  ownWindow = deps.windowId;
  const shared = deps.privateWindow ? null : deps.channel ?? null;
  channel = shared;
  shared?.addEventListener("message", ({ data }) => {
    if (owner || channel !== shared || !isSaverReply(data)) return;
    ownerReply = data;
    for (const resolve of [...replyWaiters]) resolve(data);
  });
  deps.startLifecycle();
  let stopped = false;
  let release: (() => void) | null = null;
  const becomeOwner = () => {
    if (stopped || owner) return;
    owner = true;
    deps.startTrim();
  };
  const takeLock = () => {
    if (!deps.locks) return becomeOwner();
    deps.locks.request(TAB_POLICY_LOCK, () => {
      if (stopped) return Promise.resolve();
      becomeOwner();
      return new Promise<void>((resolve) => { release = resolve; });
    }).catch((error: unknown) => {
      console.warn("[ardia linux] tab policy lock", error);
      becomeOwner();
    });
  };
  if (!deps.privateWindow) takeLock();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    idle.stop();
    unprovide();
    unwatch();
    release?.();
    release = null;
    owner = false;
    if (channel === shared) channel = null;
    shared?.close();
    if (running === stop) running = null;
  };
  running = stop;
  return stop;
}

const isSaverReply = (value: unknown): value is SaverReply =>
  typeof value === "object" && value !== null && typeof (value as SaverReply).mode === "string" && "reply" in value;

export function policyToastTarget(windowId: string): string | null {
  return !ownWindow || windowId === ownWindow ? windowId : null;
}

export function sharedBatterySaver<T>(mode: string, apply: () => Promise<T>, waitMs = BATTERY_SAVER_WAIT_MS): Promise<T> {
  const request = requestBatterySaver(mode, apply, waitMs, ++saverGeneration);
  latestSaver = request;
  return request;
}

async function requestBatterySaver<T>(mode: string, apply: () => Promise<T>, waitMs: number, generation: number): Promise<T> {
  if (owner || !channel) {
    const reply = await apply();
    if (owner) channel?.postMessage({ mode, reply });
    return reply;
  }
  if (ownerReply?.mode === mode) return ownerReply.reply as T;
  const shared = await new Promise<SaverReply | null>((resolve) => {
    const timer = setTimeout(() => { replyWaiters.delete(done); resolve(null); }, waitMs);
    const done = (reply: SaverReply) => {
      if (reply.mode !== mode) return;
      clearTimeout(timer);
      replyWaiters.delete(done);
      resolve(reply);
    };
    replyWaiters.add(done);
  });
  if (shared) return shared.reply as T;
  if (generation !== saverGeneration && latestSaver) return latestSaver as Promise<T>;
  return apply();
}

export function resetLinuxTabPoliciesForTests() {
  running = null;
  owner = false;
  ownWindow = undefined;
  channel = null;
  ownerReply = null;
  saverGeneration = 0;
  latestSaver = null;
  replyWaiters.clear();
}
