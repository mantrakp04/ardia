import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { useCardAnchors } from "../../browser/src/state/windows/layout";
import { ardiaHost } from "./host.ts";
import { inputRegions, pageHoles, useInputRegion } from "./shellAbove";
import { createPlayerHoles, cutClip, hitRects, nextFrameRunner } from "./playerHoles.ts";
import {
  aspectOf,
  clampInto,
  flingTarget,
  frameOf,
  handleAt,
  intersect,
  outside,
  placeFrame,
  PLAYER_RADIUS,
  resizeFrom,
  springSettled,
  springStep,
  type Handle,
  type Point,
  type Rect,
  type SpringAxis,
} from "./pipGeometry.ts";
import { positionAt, savePlayerFrame, sendPlayerCommand, sendPlayerViewport, usePipPlayer, type PlayerState } from "./pipPlayer.ts";

const CONTROLS_IDLE_MS = 2500;
const SEEK_SECONDS = 10;
const VELOCITY_WINDOW_MS = 100;

type Gesture =
  | { kind: "drag"; pointer: number; start: Point; rect: Rect; samples: { at: number; x: number; y: number }[] }
  | { kind: "resize"; pointer: number; start: Point; rect: Rect; handle: Handle }
  | { kind: "seek"; pointer: number };

const cursorFor = (handle: Handle | null) => {
  if (!handle) return "default";
  if (handle.x && handle.y) return handle.x === handle.y ? "nwse-resize" : "nesw-resize";
  return handle.x ? "ew-resize" : "ns-resize";
};

const same = (a: Rect | null, b: Rect | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function useViewportSync(player: number | null, rect: Rect | null) {
  const sync = useRef({ player: 0, acked: null as Rect | null, pending: null as Rect | null, inflight: false, queued: null as Rect | null });
  const [hole, setHole] = useState<Rect | null>(null);
  const publish = () => {
    const { acked, pending } = sync.current;
    setHole(acked && pending ? intersect(acked, pending) : acked);
  };
  const push = (id: number, next: Rect) => {
    const current = sync.current;
    if (current.inflight) {
      current.queued = next;
      return;
    }
    current.inflight = true;
    current.pending = next;
    publish();
    void sendPlayerViewport(id, next, true).then(
      (applied) => {
        if (sync.current.player === id && applied) sync.current.acked = next;
      },
      () => {},
    ).finally(() => {
      if (sync.current.player !== id) return;
      sync.current.inflight = false;
      sync.current.pending = null;
      const queued = sync.current.queued;
      sync.current.queued = null;
      publish();
      if (queued) push(id, queued);
    });
  };
  useLayoutEffect(() => {
    if (sync.current.player !== player) {
      sync.current = { player: player ?? 0, acked: null, pending: null, inflight: false, queued: null };
      setHole(null);
    }
    if (player && rect && !same(rect, sync.current.acked) && !same(rect, sync.current.pending)) push(player, rect);
  }, [player, rect?.x, rect?.y, rect?.width, rect?.height]);
  return hole;
}

function usePlayerHoles(root: HTMLElement | null, hole: Rect | null) {
  const holes = useMemo(() => createPlayerHoles(() => pageHoles()), []);
  useLayoutEffect(() => {
    if (!root || !hole) {
      holes.clear();
      return;
    }
    const desktop = root.closest(".ardia-desktop") as HTMLElement | null;
    if (!desktop) return;
    const apply = () => {
      const overlays = (inputRegions()?.overlayElements() ?? []).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== root && !element.contains(root));
      holes.apply({ rect: hole, radius: PLAYER_RADIUS }, [desktop], [root, ...overlays]);
      const box = root.getBoundingClientRect();
      const rectOf = (element: Element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const cuts = overlays
        .flatMap((overlay) => hitRects(overlay, (element) => getComputedStyle(element).pointerEvents !== "none", rectOf))
        .flatMap((rect) => {
          const cut = intersect(rect, { x: box.x, y: box.y, width: box.width, height: box.height });
          return cut ? [{ x: cut.x - box.x, y: cut.y - box.y, width: cut.width, height: cut.height }] : [];
        });
      const clip = cutClip(cuts);
      if (root.style.clipPath !== clip) root.style.clipPath = clip;
    };
    const frames = nextFrameRunner(apply);
    apply();
    const watcher = new MutationObserver(frames.schedule);
    watcher.observe(desktop, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", frames.schedule);
    return () => {
      frames.stop();
      watcher.disconnect();
      window.removeEventListener("resize", frames.schedule);
    };
  }, [root, hole?.x, hole?.y, hole?.width, hole?.height]);
  useLayoutEffect(() => () => holes.clear(), []);
}

export function InWindowPlayer({ windowId }: { windowId: string }) {
  const state = usePipPlayer((s) => s.state);
  const leaving = usePipPlayer((s) => s.leaving);
  const frame = usePipPlayer((s) => s.frame);
  const anchor = useCardAnchors((anchors) => anchors[windowId]);
  const area = useMemo<Rect | null>(() => (anchor && anchor.width > 0 && anchor.height > 0 ? { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height } : null), [anchor?.left, anchor?.top, anchor?.width, anchor?.height]);
  const [shown, setShown] = useState<PlayerState | null>(null);
  const [fade, setFade] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const placed = useRef<{ player: number; aspect: number; area: Rect | null }>({ player: 0, aspect: 0, area: null });
  const interacting = useRef(false);

  useEffect(() => {
    if (state) {
      setShown(state);
      setFade(null);
      return;
    }
    if (leaving && shown && leaving.player === shown.player) {
      setFade(leaving.fade);
      const timer = setTimeout(() => {
        setShown(null);
        setFade(null);
        setRect(null);
        placed.current = { player: 0, aspect: 0, area: null };
      }, leaving.fade);
      return () => clearTimeout(timer);
    }
    if (!leaving) {
      setShown(null);
      setRect(null);
    }
  }, [state, leaving]);

  useLayoutEffect(() => {
    if (!shown || !area || fade !== null) return;
    const aspect = aspectOf(shown.natural.width, shown.natural.height);
    const last = placed.current;
    if (last.player !== shown.player || !rect) {
      placed.current = { player: shown.player, aspect, area };
      setRect(placeFrame(frame, area, aspect));
      return;
    }
    if (interacting.current) return;
    const areaChanged = !last.area || !same(last.area, area);
    if (last.aspect !== aspect || areaChanged) {
      const kept = frameOf(rect, last.area ?? area);
      placed.current = { player: shown.player, aspect, area };
      setRect(placeFrame(kept, area, aspect));
    }
  }, [shown?.player, shown?.natural.width, shown?.natural.height, area, fade]);

  const hole = useViewportSync(shown?.player ?? null, fade === null ? rect : null);
  if (!shown || !rect || !area) return null;
  return <PlayerFrame state={shown} rect={rect} area={area} hole={hole} fade={fade} onRect={setRect} interacting={interacting} />;
}

function PlayerFrame({ state, rect, area, hole, fade, onRect, interacting }: {
  state: PlayerState;
  rect: Rect;
  area: Rect;
  hole: Rect | null;
  fade: number | null;
  onRect: (rect: Rect) => void;
  interacting: { current: boolean };
}) {
  const root = useRef<HTMLDivElement>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState(false);
  const [cursor, setCursor] = useState("default");
  const [, tick] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spring = useRef<number | null>(null);
  const overControl = useRef(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  useInputRegion(root, "box");
  usePlayerHoles(element, hole);
  useLayoutEffect(() => setElement(root.current), []);

  useEffect(() => {
    if (!controls || !state.playing) return;
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [controls, state.playing]);

  useEffect(() => () => {
    if (idle.current) clearTimeout(idle.current);
    if (spring.current !== null) cancelAnimationFrame(spring.current);
  }, []);

  const wake = () => {
    setControls(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      if (!overControl.current && !gesture.current) setControls(false);
    }, CONTROLS_IDLE_MS);
  };

  const stopSpring = () => {
    if (spring.current !== null) cancelAnimationFrame(spring.current);
    spring.current = null;
  };

  const settle = (final: Rect) => {
    interacting.current = false;
    void savePlayerFrame(frameOf(final, area), ardiaHost);
  };

  const throwTo = (target: Rect, velocity: Point) => {
    stopSpring();
    interacting.current = true;
    let x: SpringAxis = { position: rectRef.current.x, velocity: velocity.x };
    let y: SpringAxis = { position: rectRef.current.y, velocity: velocity.y };
    let last = performance.now();
    const step = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      x = springStep(x, target.x, seconds);
      y = springStep(y, target.y, seconds);
      const done = springSettled(x, target.x) && springSettled(y, target.y);
      const next = done ? target : { ...rectRef.current, x: Math.round(x.position), y: Math.round(y.position) };
      onRect(next);
      if (done) {
        spring.current = null;
        settle(target);
        return;
      }
      spring.current = requestAnimationFrame(step);
    };
    spring.current = requestAnimationFrame(step);
  };

  const local = (event: ReactPointerEvent) => ({ x: event.clientX, y: event.clientY });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.button !== 0 || fade !== null) return;
    stopSpring();
    const point = local(event);
    const handle = handleAt(point, rect);
    event.currentTarget.setPointerCapture(event.pointerId);
    interacting.current = true;
    gesture.current = handle
      ? { kind: "resize", pointer: event.pointerId, start: point, rect, handle }
      : { kind: "drag", pointer: event.pointerId, start: point, rect, samples: [{ at: event.timeStamp, ...point }] };
    wake();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    const point = local(event);
    if (!current || current.pointer !== event.pointerId) {
      setCursor(cursorFor(handleAt(point, rect)));
      wake();
      return;
    }
    if (current.kind === "resize") {
      onRect(resizeFrom(current.rect, current.handle, { x: point.x - current.start.x, y: point.y - current.start.y }, aspectOf(state.natural.width, state.natural.height), area));
      return;
    }
    if (current.kind !== "drag") return;
    if (outside(point, { width: window.innerWidth, height: window.innerHeight })) {
      gesture.current = null;
      interacting.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      void sendPlayerCommand(state.player, "popOut", {
        at: { x: event.screenX, y: event.screenY },
        grab: { x: current.start.x - current.rect.x, y: current.start.y - current.rect.y },
      }, ardiaHost);
      return;
    }
    current.samples.push({ at: event.timeStamp, ...point });
    while (current.samples.length > 2 && event.timeStamp - (current.samples[0]?.at ?? event.timeStamp) > VELOCITY_WINDOW_MS) current.samples.shift();
    onRect(clampInto({ ...current.rect, x: current.rect.x + point.x - current.start.x, y: current.rect.y + point.y - current.start.y }, area));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.kind === "drag") {
      const point = local(event);
      const first = current.samples[0] ?? { at: event.timeStamp, ...point };
      const elapsed = Math.max(1, event.timeStamp - first.at) / 1000;
      const velocity = { x: (point.x - first.x) / elapsed, y: (point.y - first.y) / elapsed };
      const target = flingTarget(rectRef.current, point, velocity, area);
      if (target) {
        throwTo(target, velocity);
        return;
      }
    }
    settle(rectRef.current);
  };

  const command = (action: string, extra?: Record<string, unknown>) => void sendPlayerCommand(state.player, action, extra, ardiaHost);
  const position = positionAt(state.position, state.playing, performance.now());
  const duration = state.position?.duration ?? null;
  const fraction = position !== null && duration ? Math.min(1, Math.max(0, position / duration)) : 0;
  const compact = rect.width < 220;

  const seekAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const bar = event.currentTarget.getBoundingClientRect();
    command("seekTo", { seconds: (Math.min(1, Math.max(0, (event.clientX - bar.x) / bar.width))) * duration });
  };

  const button = (name: string, label: string, action: () => void, glyph: ReactElement, style: CSSProperties) => (
    <button
      type="button"
      className={`ardia-pip-button ${name}`}
      aria-label={label}
      title={label}
      style={style}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerEnter={() => (overControl.current = true)}
      onPointerLeave={() => (overControl.current = false)}
      onClick={(event) => {
        event.stopPropagation();
        action();
        wake();
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div
      ref={root}
      className="ardia-pip-player"
      data-ardia-pip-player={state.player}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        cursor,
        opacity: fade === null ? 1 : 0,
        transition: fade === null ? undefined : `opacity ${fade}ms ease-out`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!gesture.current && !overControl.current) setControls(false);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={`ardia-pip-controls${controls && fade === null ? " shown" : ""}`}>
        <div className="ardia-pip-scrim" />
        {button("back", "Back to tab", () => command("backToTab"), <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden><path d="M10.5 18.5V10.5H18.5M10.5 10.5L19 19" /></svg>, { left: 12, top: 12, width: 28, height: 28 })}
        {button("popout", "Pop out", () => command("popOut"), <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden><path d="M12.5 9.5H9.5V18.5H18.5V15.5M14.5 13.5L19 9M15 9H19V13" /></svg>, { right: 49, top: 12, width: 28, height: 28 })}
        {button("close", "Close", () => command("close"), <svg width="29" height="28" viewBox="0 0 29 28" aria-hidden><path d="M9.5 9.5L19 19M19 9.5L9.5 19" /></svg>, { right: 12, top: 12, width: 29, height: 28 })}
        {state.origin && <div className="ardia-pip-origin" style={{ left: 48, right: 85 }}>{state.origin}</div>}
        {state.playPause &&
          button("playpause", state.playing ? "Pause" : "Play", () => command("togglePlayPause"),
            state.playing
              ? <svg width="24" height="42" viewBox="0 0 24 42" aria-hidden><rect x="0" y="0" width="7" height="42" rx="3.5" /><rect x="17" y="0" width="7" height="42" rx="3.5" /></svg>
              : <svg width="36" height="42" viewBox="0 0 36 42" aria-hidden><path d="M4 4.5C4 2 6.7 0.5 8.9 1.8L33 18.6C35 19.9 35 22.1 33 23.4L8.9 40.2C6.7 41.5 4 40 4 37.5Z" /></svg>,
            { left: rect.width / 2 - 24, top: rect.height / 2 - 23.5, width: 48, height: 48 })}
        {state.playPause && !compact && duration !== null &&
          button("replay", "Back 10 seconds", () => command("seekBy", { seconds: -SEEK_SECONDS }), <SeekGlyph forward={false} />, { left: rect.width / 2 - 76 - 20, top: rect.height / 2 - 20, width: 40, height: 40 })}
        {state.playPause && !compact && duration !== null &&
          button("forward", "Forward 10 seconds", () => command("seekBy", { seconds: SEEK_SECONDS }), <SeekGlyph forward />, { left: rect.width / 2 + 76 - 20, top: rect.height / 2 - 20, width: 40, height: 40 })}
        {duration !== null && (
          <div
            className="ardia-pip-progress"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              gesture.current = { kind: "seek", pointer: event.pointerId };
              seekAt(event);
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (gesture.current?.kind === "seek" && gesture.current.pointer === event.pointerId) seekAt(event);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              if (gesture.current?.kind === "seek") gesture.current = null;
            }}
            onPointerEnter={() => (overControl.current = true)}
            onPointerLeave={() => (overControl.current = false)}
          >
            <div className="ardia-pip-progress-played" style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function SeekGlyph({ forward }: { forward: boolean }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden style={forward ? { transform: "scaleX(-1)" } : undefined}>
      <path className="stroke" d="M9 9.5A10 10 0 1 1 6 16.5" />
      <path d="M5 5V11.5H11.5Z" />
      <text x="16" y="20" textAnchor="middle" style={forward ? { transform: "scaleX(-1)", transformOrigin: "16px 16px" } : undefined}>10</text>
    </svg>
  );
}
