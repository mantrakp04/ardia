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
const moved = (a: Frame, b: Frame) => a.some((v, i) => Math.abs(v - b[i]!) > 0.01);

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
    views.forEach(([, f], i) => {
      const was = before[i];
      const now = after[i];
      if (was && now && moved(was, now)) shifts.push({ scope, hovered: label(fiber), view: label(f), before: was, after: now });
    });
    props.onMouseLeave();
    await frames(settleFrames);
  }
  return { hovered: targets.length, shifts };
}
