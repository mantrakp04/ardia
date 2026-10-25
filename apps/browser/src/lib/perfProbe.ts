type Fiber = {
  tag: number;
  flags: number;
  type: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: Record<string, unknown> | null;
  memoizedState: unknown;
  dependencies: { firstContext: ContextItem | null } | null;
  stateNode: unknown;
  selfBaseDuration?: number;
  actualDuration?: number;
};

type ContextItem = { context: { displayName?: string }; memoizedValue: unknown; next: ContextItem | null };
type Hook = { memoizedState: unknown; queue: unknown; next: Hook | null };

type Store = {
  subscribe: (listener: (s: unknown, prev: unknown) => void) => () => void;
  getState: () => unknown;
};

type Counter = Record<string, number>;

if (!(globalThis as { expo?: unknown }).expo) {
  try {
    const { TurboModuleRegistry } = require("react-native") as typeof import("react-native");
    (TurboModuleRegistry.get("ExpoModulesCore") as { installModules?: () => void } | null)?.installModules?.();
  } catch {}
}
const modules = (globalThis as { expo?: { modules?: Record<string, Record<string, (...a: unknown[]) => unknown>> } }).expo?.modules;
const shell = modules?.ArdiaShell;

const probeOptions = (() => {
  try {
    const info = modules?.ArdiaApp?.systemInfo?.() as
      | { scratchInstance?: boolean; isolatedInstance?: boolean }
      | undefined;
    if (
      info?.scratchInstance !== true ||
      info?.isolatedInstance !== true ||
      typeof shell?.readDocument !== "function"
    )
      return null;
    const file = shell.readDocument("perf-probe");
    return typeof file === "string" ? file : null;
  } catch {
    return null;
  }
})();

export const perfProbeEnabled = probeOptions !== null;

export const PERF_PROBE_REVISION = 2;
const rendersProbe = !!probeOptions?.includes("renders");
const listenersProbe = !!probeOptions?.includes("listeners");
const layoutProbe = !!probeOptions?.includes("layout");
const layoutEditAt = probeOptions?.includes("layoutEdit") ? 2 : 0;

const now = () => performance.now();
const bump = (c: Counter, key: string, by = 1) => void (c[key] = (c[key] ?? 0) + by);

function fresh() {
  return {
    since: now(),
    commits: 0,
    commitTimes: [] as number[],
    commitTaskLog: [] as string[],
    renders: {} as Counter,
    hooks: {} as Counter,
    mounts: {} as Counter,
    hostUpdates: 0,
    walkMs: 0,
    storeUpdates: {} as Counter,
    storeKeys: {} as Counter,
    listenerCalls: {} as Counter,
    listenerMs: {} as Counter,
    listenerSiteCalls: {} as Counter,
    listenerSiteMs: {} as Counter,
    tasks: {} as Counter,
    taskMs: {} as Counter,
    taskLog: [] as [string, number][],
    commitTasks: {} as Counter,
    timers: {} as Counter,
    timerMs: {} as Counter,
    timersScheduled: {} as Counter,
    subNotified: {} as Counter,
    selectorCalls: {} as Counter,
    selectorMs: {} as Counter,
    writes: {} as Counter,
    writeBytes: {} as Counter,
    writeMs: {} as Counter,
    wasted: {} as Counter,
    wastedMs: {} as Counter,
    unstable: {} as Counter,
    unstableMs: {} as Counter,
    renderMs: {} as Counter,
    causes: {} as Record<string, Counter>,
    origins: {} as Counter,
    commitMs: 0,
  };
}

let stats = fresh();
const subscriptions: Counter = {};
const marks: Record<string, number> = {};
const startedAt = now();
const startup: [task: string, at: number, ms: number][] = [];
const roots = new Set<{ current: Fiber }>();
let firstCommit = 0;
let firstCommitMounts: Counter | null = null;
let task: string | null = null;

function nameOf(type: unknown): string {
  if (typeof type === "function") return (type as { displayName?: string }).displayName || type.name || "Anonymous";
  if (type && typeof type === "object") {
    const t = type as { displayName?: string; render?: unknown; type?: unknown };
    if (t.displayName) return t.displayName;
    if (t.render) return nameOf(t.render);
    if (t.type) return nameOf(t.type);
  }
  return String(type);
}

const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
const PERFORMED_WORK = 1;
const UPDATE = 4;
const HOST_COMPONENT = 5;

function walk(fiber: Fiber) {
  if (fiber.alternate && fiber.child === fiber.alternate.child) return;
  for (let c = fiber.child; c; c = c.sibling) {
    if (COMPONENT_TAGS.has(c.tag)) {
      if (!c.alternate) bump(stats.mounts, nameOf(c.type));
      else if (c.flags & PERFORMED_WORK) {
        const name = nameOf(c.type);
        bump(stats.renders, name);
        if (c.tag !== 1) {
          let hooks = 0;
          for (let h = c.memoizedState as Hook | null; h; h = h.next) hooks++;
          bump(stats.hooks, name, hooks);
        }
        if (rendersProbe) classify(c, c.alternate);
      }
    } else if (c.tag === HOST_COMPONENT && c.alternate && c.flags & UPDATE) stats.hostUpdates++;
    walk(c);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function shallowEqual(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}

function classify(fiber: Fiber, before: Fiber) {
  const name = nameOf(fiber.type);
  const causes: string[] = [];
  const props = fiber.memoizedProps ?? {};
  const prev = before.memoizedProps ?? {};
  let propsChanged = false;
  let realProps = false;
  if (props !== prev) {
    for (const key of new Set([...Object.keys(props), ...Object.keys(prev)])) {
      const a = props[key];
      const b = prev[key];
      if (Object.is(a, b)) continue;
      propsChanged = true;
      if (typeof a === "function" && typeof b === "function") causes.push(`fn:${key}`);
      else if (key !== "children" && isObject(a) && isObject(b) && shallowEqual(a, b)) causes.push(`obj:${key}`);
      else {
        realProps = true;
        causes.push(`props:${key}`);
      }
    }
  }
  let stateChanged = false;
  if (fiber.tag === 1) {
    if (!shallowEqual(fiber.memoizedState, before.memoizedState)) {
      stateChanged = true;
      causes.push("state");
    }
  } else {
    let h = fiber.memoizedState as Hook | null;
    let o = before.memoizedState as Hook | null;
    for (; h && o; h = h.next, o = o.next) {
      if (h.queue == null || Object.is(h.memoizedState, o.memoizedState)) continue;
      stateChanged = true;
      causes.push(shallowEqual(h.memoizedState, o.memoizedState) ? "state~" : "state");
    }
  }
  let contextChanged = false;
  let ci = fiber.dependencies?.firstContext ?? null;
  let co = before.dependencies?.firstContext ?? null;
  for (; ci; ci = ci.next, co = co?.next ?? null) {
    if (co && Object.is(ci.memoizedValue, co.memoizedValue)) continue;
    contextChanged = true;
    causes.push(`context:${ci.context.displayName ?? "?"}`);
  }
  const ms = fiber.selfBaseDuration ?? 0;
  bump(stats.renderMs, name, ms);
  const counter = (stats.causes[name] ??= {});
  if (!propsChanged && !stateChanged && !contextChanged) {
    bump(stats.wasted, name);
    bump(stats.wastedMs, name, ms);
    bump(counter, "wasted");
  } else {
    if (!propsChanged) bump(stats.origins, name);
    else if (!realProps && !stateChanged && !contextChanged) {
      bump(stats.unstable, name);
      bump(stats.unstableMs, name, ms);
    }
    for (const cause of new Set(causes)) bump(counter, cause);
  }
}

function installReactHook() {
  let ids = 0;
  (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => ++ids,
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      const t = now();
      firstCommit ||= Date.now();
      roots.add(root);
      stats.commits++;
      bump(stats.commitTasks, task ?? "other");
      if (stats.commitTimes.length < 5000) {
        stats.commitTimes.push(t);
        stats.commitTaskLog.push(task ?? "other");
      }
      const mountsBefore = firstCommitMounts ? null : { ...stats.mounts };
      try {
        walk(root.current);
      } catch {}
      if (mountsBefore) {
        firstCommitMounts = {};
        for (const key in stats.mounts) if (stats.mounts[key]! > (mountsBefore[key] ?? 0)) firstCommitMounts[key] = stats.mounts[key]! - (mountsBefore[key] ?? 0);
      }
      stats.commitMs += root.current.actualDuration ?? 0;
      stats.walkMs += now() - t;
      if (layoutProbe) {
        try {
          (require("./layoutWatch") as typeof import("./layoutWatch")).layoutCommitted(layoutEditAt);
        } catch {}
      }
    },
  };
}

let traceTimers = false;
let traceDepth = 4;

const callers = (stack: string | undefined, depth = 4) =>
  (stack ?? "")
    .split("\n")
    .slice(2, 2 + depth)
    .map((line) => /at (\S+)/.exec(line)?.[1] ?? "?")
    .join(" < ");

function wrapTimers() {
  const g = globalThis as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ["setTimeout", "setInterval", "requestAnimationFrame", "setImmediate"]) {
    const original = g[name];
    if (typeof original !== "function") continue;
    g[name] = function (this: unknown, callback: unknown, ...rest: unknown[]) {
      if (typeof callback !== "function") return original.call(this, callback, ...rest);
      let label = `${name}:${callback.name || "anonymous"}`;
      if (traceTimers && !callback.name) label += ` <${callers(new Error().stack, traceDepth)}>`;
      bump(stats.timersScheduled, label);
      return original.call(
        this,
        function (this: unknown, ...args: unknown[]) {
          const t = now();
          const outer = task;
          task = label;
          try {
            return (callback as (...a: unknown[]) => unknown).apply(this, args);
          } finally {
            task = outer;
            bump(stats.timers, label);
            bump(stats.timerMs, label, now() - t);
          }
        },
        ...rest,
      );
    };
  }
}

function wrapSelectors() {
  const react = require("react") as { useSyncExternalStore: (...a: unknown[]) => unknown };
  const original = react.useSyncExternalStore;
  const counted = new WeakMap<object, Map<string, unknown>>();
  react.useSyncExternalStore = (subscribe: unknown, getSnapshot: unknown, getServerSnapshot: unknown) => {
    const label = callers(new Error().stack, 4);
    let bySite = counted.get(subscribe as object);
    if (!bySite) counted.set(subscribe as object, (bySite = new Map()));
    let tracked = bySite.get(label);
    if ((subscribe as { inert?: boolean }).inert) tracked = subscribe;
    else if (!tracked) {
      const raw = subscribe as (cb: () => void) => () => void;
      tracked = (cb: () => void) => {
        bump(subscriptions, label);
        const off = raw(() => {
          bump(stats.subNotified, label);
          cb();
        });
        return () => {
          bump(subscriptions, label, -1);
          off();
        };
      };
      bySite.set(label, tracked);
    }
    subscribe = tracked;
    const get = getSnapshot as () => unknown;
    const timed = () => {
      const t = now();
      try {
        return get();
      } finally {
        bump(stats.selectorCalls, label);
        bump(stats.selectorMs, label, now() - t);
      }
    };
    return original(subscribe, timed, getServerSnapshot);
  };
}

function wrapBridge() {
  const queue = (globalThis as { __fbBatchedBridge?: Record<string, (...a: unknown[]) => unknown> }).__fbBatchedBridge;
  if (!queue) return;
  const wrap = (method: string, label: (args: unknown[]) => string) => {
    const original = queue[method];
    if (typeof original !== "function") return;
    queue[method] = (...args: unknown[]) => {
      const t = now();
      const key = label(args);
      task = key;
      if (key !== "JSTimers.callTimers" && stats.taskLog.length < 5000) stats.taskLog.push([key, t]);
      try {
        return original.apply(queue, args);
      } finally {
        task = null;
        const end = now();
        bump(stats.tasks, key);
        bump(stats.taskMs, key, end - t);
        if (!marks.firstWindow && startup.length < 1000) startup.push([key, Math.round(t - startedAt), Math.round((end - t) * 10) / 10]);
      }
    };
  };
  wrap("callFunctionReturnFlushedQueue", ([module, method, args]) => {
    if (module === "RCTEventEmitter" && Array.isArray(args)) return `event:${String(args[1])}`;
    if (module === "RCTDeviceEventEmitter" && Array.isArray(args)) return `device:${String(args[0])}`;
    return `${String(module)}.${String(method)}`;
  });
  wrap("invokeCallbackAndReturnFlushedQueue", () => "callback");
}

function wrapModuleEvents() {
  const proto = (globalThis as unknown as { expo?: { EventEmitter?: { prototype: Record<string, unknown> } } }).expo?.EventEmitter?.prototype;
  const add = proto?.addListener as ((this: unknown, name: string, listener: (...a: unknown[]) => void) => unknown) | undefined;
  const remove = proto?.removeListener as ((this: unknown, name: string, listener: unknown) => unknown) | undefined;
  if (!proto || typeof add !== "function" || typeof remove !== "function") return;
  const wrapped = new WeakMap<object, Map<string, (...a: unknown[]) => void>>();
  proto.addListener = function (this: unknown, name: string, listener: (...a: unknown[]) => void) {
    if (typeof listener !== "function") return add.call(this, name, listener);
    const key = `module:${name}`;
    const byName = wrapped.get(listener) ?? new Map<string, (...a: unknown[]) => void>();
    wrapped.set(listener, byName);
    const timed =
      byName.get(name) ??
      function (this: unknown, ...args: unknown[]) {
        if (task !== null) return listener.apply(this, args);
        const t = now();
        task = key;
        if (stats.taskLog.length < 5000) stats.taskLog.push([key, t]);
        try {
          return listener.apply(this, args);
        } finally {
          task = null;
          bump(stats.tasks, key);
          bump(stats.taskMs, key, now() - t);
        }
      };
    byName.set(name, timed);
    return add.call(this, name, timed);
  };
  proto.removeListener = function (this: unknown, name: string, listener: unknown) {
    return remove.call(this, name, (typeof listener === "function" && wrapped.get(listener)?.get(name)) || listener);
  };
}

function wrapWrites() {
  const original = shell?.writeDocument;
  if (typeof original !== "function") return;
  try {
    shell!.writeDocument = (name: unknown, contents: unknown) => {
      const t = now();
      try {
        return original(name, contents);
      } finally {
        const key = String(name);
        bump(stats.writes, key);
        bump(stats.writeBytes, key, typeof contents === "string" ? contents.length : 0);
        bump(stats.writeMs, key, now() - t);
      }
    };
  } catch {}
}

export function probeStore(name: string, store: Store) {
  if (!perfProbeEnabled) return;
  const subscribe = store.subscribe;
  store.subscribe = Object.assign((listener: Parameters<Store["subscribe"]>[0]) => {
    const site = listenersProbe ? `${name} ${callers(new Error().stack, 3)}` : "";
    return subscribe((s, prev) => {
      const t = now();
      try {
        listener(s, prev);
      } finally {
        const ms = now() - t;
        bump(stats.listenerCalls, name);
        bump(stats.listenerMs, name, ms);
        if (site) {
          bump(stats.listenerSiteCalls, site);
          bump(stats.listenerSiteMs, site, ms);
        }
      }
    });
  }, { unprobed: subscribe });
  subscribe((s, prev) => {
    bump(stats.storeUpdates, name);
    const a = s as Record<string, unknown>;
    const b = prev as Record<string, unknown>;
    for (const key in a) if (a[key] !== b[key]) bump(stats.storeKeys, `${name}.${key}`);
  });
}

export function perfMark(name: string) {
  if (perfProbeEnabled && !marks[name]) marks[name] = Date.now();
}

function findFibers(name: string, limit = 50): Fiber[] {
  const out: Fiber[] = [];
  const visit = (f: Fiber | null) => {
    for (let c = f; c && out.length < limit; c = c.sibling) {
      if (COMPONENT_TAGS.has(c.tag) && nameOf(c.type) === name) out.push(c);
      visit(c.child);
    }
  };
  for (const root of roots) visit(root.current);
  return out;
}

if (perfProbeEnabled) {
  marks.bundleStart = Date.now();
  installReactHook();
  wrapTimers();
  wrapBridge();
  wrapModuleEvents();
  wrapWrites();
  if (probeOptions?.includes("selectors")) wrapSelectors();
  (globalThis as { acPerf?: unknown }).acPerf = {
    revision: PERF_PROBE_REVISION,
    marks,
    startup,
    get firstCommit() {
      return firstCommit;
    },
    get firstCommitMounts() {
      return firstCommitMounts;
    },
    reset: () => void (stats = fresh()),
    set traceTimers(on: boolean) {
      traceTimers = on;
    },
    set traceDepth(n: number) {
      traceDepth = n;
    },
    read: () => ({ ...stats, elapsed: now() - stats.since }),
    now,
    batch: (fn: () => void) => (require("react-native") as typeof import("react-native")).unstable_batchedUpdates(fn),
    findFibers,
    nameOf,
    subscriptions: () => ({ ...subscriptions }),
  };
}
