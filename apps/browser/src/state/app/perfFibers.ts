import { bump, type PerfStats } from "./perfStats";

export type Fiber = {
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

export const roots = new Set<{ current: Fiber }>();

export function nameOf(type: unknown): string {
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

export function walk(fiber: Fiber, stats: PerfStats, classifyRenders: boolean) {
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
        if (classifyRenders) classify(c, c.alternate, stats);
      }
    } else if (c.tag === HOST_COMPONENT && c.alternate && c.flags & UPDATE) stats.hostUpdates++;
    walk(c, stats, classifyRenders);
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

function classify(fiber: Fiber, before: Fiber, stats: PerfStats) {
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

export function findFibers(name: string, limit = 50): Fiber[] {
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
