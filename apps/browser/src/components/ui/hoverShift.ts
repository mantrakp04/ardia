import { isMarkedHover } from "../../lib/hoverMarks";
import { HoverSlot } from "./HoverSlot";

type Fiber = {
  type: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
};
type Host = { measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void };
type Frame = [number, number, number, number];
export type Shift = { scope: string; hovered: string; view: string; before: Frame; after: Frame };

const nameOf = (f: Fiber): string => {
  const t = f.type as { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } } | string | null;
  if (!t) return "";
  if (typeof t === "string") return t;
  return t.displayName || t.name || t.render?.name || t.type?.name || "";
};
const isHost = (f: Fiber) => typeof (f.stateNode as Host | null)?.measureInWindow === "function" && typeof f.type === "string";

function* fibers(root: Fiber, skip?: (f: Fiber) => boolean): Generator<Fiber> {
  const stack = [root];
  while (stack.length) {
    const f = stack.pop()!;
    yield f;
    if (skip?.(f)) continue;
    const kids: Fiber[] = [];
    for (let c = f.child; c; c = c.sibling) kids.push(c);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
}

function roots(): Fiber[] {
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers: Map<number, unknown>; getFiberRoots(id: number): Set<{ current: Fiber }> } })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("no React DevTools hook (a Debug build has one)");
  return [...hook.renderers.keys()].flatMap((id) => [...hook.getFiberRoots(id)].map((r) => r.current));
}

function label(f: Fiber): string {
  const names: string[] = [];
  for (let x: Fiber | null = f; x && names.length < 4; x = x.return) {
    const n = nameOf(x);
    if (n && typeof x.type !== "string" && !n.startsWith("Animated") && n !== "View" && n !== "Pressable") names.push(n);
  }
  return `${names.reverse().join(" › ")} (${nameOf(f)})`;
}

function around(f: Fiber): Map<Host, Fiber> {
  let parent = f.return;
  while (parent && !isHost(parent)) parent = parent.return;
  const out = new Map<Host, Fiber>();
  if (!parent) return out;
  for (const x of fibers(parent, (x) => isHost(x) && x.return?.type === HoverSlot)) if (isHost(x)) out.set(x.stateNode as Host, x);
  return out;
}

const measure = (h: Host) =>
  new Promise<Frame | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 500);
    h.measureInWindow((x, y, w, hgt) => {
      clearTimeout(timer);
      resolve([x, y, w, hgt]);
    });
  });
const frames = (n: number) => new Promise<void>((resolve) => {
  const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
  step();
});
const EPSILON = 0.01;
const near = (a: number, b: number) => Math.abs(a - b) <= EPSILON;
const moved = (a: Frame, b: Frame) => a.some((v, i) => !near(v, b[i]!));
const right = (f: Frame) => f[0] + f[2];

function hostParent(f: Fiber): Fiber | null {
  let p = f.return;
  while (p && !isHost(p)) p = p.return;
  return p;
}

function opensOnHover(host: Fiber): boolean {
  for (let x = host.return; x && !isHost(x); x = x.return) {
    if (x.type === HoverSlot) return x.memoizedProps?.reserve === "hover";
  }
  return false;
}

type Measured = { host: Fiber; was: Frame | null; now: Frame | null };

function hoverSlotOpenings(views: Measured[]): Set<Fiber> {
  const allowed = new Set<Fiber>();
  for (const slot of views) {
    const { was, now } = slot;
    if (!was || !now || !opensOnHover(slot.host)) continue;
    const grow = now[2] - was[2];
    if (grow <= EPSILON || !near(right(was), right(now)) || !near(was[1], now[1]) || !near(was[3], now[3])) continue;
    allowed.add(slot.host);
    const parent = hostParent(slot.host);
    for (const v of views) {
      if (v === slot || !v.was || !v.now || hostParent(v.host) !== parent) continue;
      const narrowed =
        near(v.was[0], v.now[0]) && near(v.was[1], v.now[1]) && near(v.was[3], v.now[3]) &&
        near(v.was[2] - v.now[2], grow) && near(right(v.was), was[0]) && near(right(v.now), now[0]);
      if (narrowed) allowed.add(v.host);
    }
  }
  return allowed;
}

export async function check({ scopes, settleFrames = 3 }: { scopes?: string[]; settleFrames?: number } = {}): Promise<{ hovered: number; shifts: Shift[] }> {
  const targets: { scope: string; fiber: Fiber }[] = [];
  for (const root of roots()) {
    const scopeRoots = scopes ? [...fibers(root)].filter((f) => scopes.includes(nameOf(f))) : [root];
    for (const scope of scopeRoots) {
      for (const f of fibers(scope)) {
        const enter = f.memoizedProps?.onMouseEnter;
        if (isHost(f) && isMarkedHover(enter)) targets.push({ scope: nameOf(scope) || "root", fiber: f });
      }
    }
  }
  const shifts: Shift[] = [];
  for (const { scope, fiber } of targets) {
    const props = fiber.memoizedProps as { onMouseEnter?: () => void; onMouseLeave?: () => void } | null;
    if (!props?.onMouseEnter || !props.onMouseLeave) continue;
    const views = [...around(fiber)];
    const before = await Promise.all(views.map(([h]) => measure(h)));
    props.onMouseEnter();
    await frames(settleFrames);
    const after = await Promise.all(views.map(([h]) => measure(h)));
    const measured = views.map(([, host], i) => ({ host, was: before[i] ?? null, now: after[i] ?? null }));
    const openings = hoverSlotOpenings(measured);
    for (const { host, was, now } of measured) {
      if (was && now && moved(was, now) && !openings.has(host)) shifts.push({ scope, hovered: label(fiber), view: label(host), before: was, after: now });
    }
    props.onMouseLeave();
    await frames(settleFrames);
  }
  return { hovered: targets.length, shifts };
}
