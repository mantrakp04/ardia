import { devRegister } from "../dev/devRegister";
import { createContext, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { layout, useTheme } from "../ui/theme";
import type { BrowserState } from "../../state/browser/store";
import { workspaceSnapshot } from "../../state/browser/current";
import type { Capture, ListSnapshot } from "../../state/sidebar/listCapture";
import { useAnimatedStyle, type ClipSource, type EntryMotion } from "./EntryMotion";
import { groupEntries } from "../../state/sidebar/entries";
import { entryHeight } from "../../state/sidebar/geometry";
import { ghostEntry, snapshotEntry, type EntrySnapshot } from "./GhostEntry";
import { curve } from "../ui/motion";
import { SIDEBAR_MOTION } from "./tokens";
import { entryId, entryKey, parseEntry } from "../../state/sidebar/entryKey";
import { splitTabIdsOf } from "../../state/splits/splits";

export const SLIDE_MS = SIDEBAR_MOTION.listSlide;
export const FADE_MS = SIDEBAR_MOTION.listFade;
export const SLIDE_EASING = curve.cssEase;
export const FADE_EASING = curve.cssEaseOut;
const GAP = layout.rowGap;
const TAIL = "~tail";
const FRAME_SLACK_MS = 50;
const devScale = () => (__DEV__ ? ((globalThis as { sidebarMotionScale?: number }).sidebarMotionScale ?? 1) : 1);

type Slide = { value: Animated.Value; from: number; at: number; until: number; landed: boolean };
type Ghost = { key: string; anchor: string | null; y: number; snapshot: EntrySnapshot; opacity: Animated.Value; until: number };
type Snapshot = ListSnapshot;
type Move = { key: string; from: number };
type Plan = { moves: Move[]; ghosts: Ghost[]; clipped: string[]; below: number };
type Offsets = { at: Map<string, number>; end: number };
type Height = (s: BrowserState, entry: string) => number;
type Planner = (before: Snapshot, after: Snapshot, slides: Map<string, Slide>, ghosts: Ghost[], t: number) => Plan | null;
export type ListSlot = { entry: string } | { ghost: Ghost; top: number };
export type ListMotionScope = { enabled: boolean; slideBelow: ((entry: string, delta: number) => void) | null };

export const ListMotionContext = createContext<ListMotionScope>({ enabled: false, slideBelow: null });
let ghostIds = 0;

const tabsOf = (s: BrowserState, entry: string): string[] => {
  const { kind, id } = parseEntry(entry);
  if (kind === "group") return s.groups[id]?.tabIds ?? [];
  if (kind === "split") return splitTabIdsOf(s.splits[id]) ?? [];
  return [id];
};

const closedIn = (before: BrowserState, after: BrowserState) => (entry: string) => {
  const ids = tabsOf(before, entry);
  return ids.length > 0 && ids.every((id) => !after.tabs[id]);
};

const openedIn = (before: BrowserState, after: BrowserState) => (entry: string) => {
  const ids = tabsOf(after, entry);
  return ids.length > 0 && ids.every((id) => !before.tabs[id]);
};

function offsets(s: BrowserState, entries: string[], height: Height, start = 0, base = 0): Offsets {
  const at = new Map<string, number>();
  let y = base;
  for (let i = start; i < entries.length; i++) {
    at.set(entries[i]!, y);
    y += height(s, entries[i]!) + GAP;
  }
  return { at, end: y };
}

function sharedPrefix(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function prefixHeight(s: BrowserState, entries: string[], count: number, height: Height): number {
  let y = 0;
  for (let i = 0; i < count; i++) y += height(s, entries[i]!) + GAP;
  return y;
}

function shiftAt(slide: Slide | undefined, t: number): number {
  if (!slide) return 0;
  const p = Math.min(1, Math.max(0, (t - slide.at) / (SLIDE_MS * devScale())));
  return slide.from * (1 - SLIDE_EASING(p));
}

type Diff = {
  before: Snapshot;
  after: Snapshot;
  old: Offsets;
  next: Offsets;
  removed: string[];
  added: string[];
  slides: Map<string, Slide>;
  ghosts: Ghost[];
  t: number;
  tail: boolean;
  snapshot: (entry: string) => EntrySnapshot | null;
  clipAfter: string[];
  start: number;
};

function buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail, snapshot, clipAfter, start }: Diff): Plan | null {
  const kept = new Set(after.list.slice(start));
  const had = new Set(before.list.slice(start));
  const moves: Move[] = [];
  for (let i = start; i < after.list.length; i++) {
    const e = after.list[i]!;
    if (!had.has(e) || !next.at.has(e)) continue;
    const delta = old.at.get(e)! - next.at.get(e)!;
    if (delta) moves.push({ key: e, from: shiftAt(slides.get(e), t) + delta });
  }
  if (tail && old.end !== next.end) moves.push({ key: TAIL, from: shiftAt(slides.get(TAIL), t) + old.end - next.end });
  const anchorAfter = (entry: string): string | null => {
    for (let i = before.list.indexOf(entry, start) + 1; i < before.list.length; i++) if (kept.has(before.list[i]!)) return before.list[i]!;
    return null;
  };
  const gone = new Set(removed);
  for (const g of ghosts) if (g.anchor && gone.has(g.anchor)) g.anchor = anchorAfter(g.anchor);
  const born = removed.flatMap((e): Ghost[] => {
    const shot = snapshot(e);
    if (!shot) return [];
    const y = old.at.get(e)! + shiftAt(slides.get(e), t);
    return [{ key: `ghost:${++ghostIds}`, anchor: anchorAfter(e), y, snapshot: shot, opacity: new Animated.Value(1), until: 0 }];
  });
  if (!moves.length) return born.length ? { moves, ghosts: born, clipped: [], below: 0 } : null;
  const fresh = new Set(added);
  const clipped = [...added, ...clipAfter].flatMap((e) => {
    const following = after.list[after.list.indexOf(e) + 1];
    return following === undefined ? (tail ? [TAIL] : []) : fresh.has(following) ? [] : [following];
  });
  return { moves, ghosts: born, clipped, below: 0 };
}

type GroupChange = "same" | "grown" | "extended" | "other";

function groupGrowsAtEnd(before: BrowserState, after: BrowserState, groupId: string): boolean {
  const last = groupEntries(after, groupId).at(-1);
  return !!last && !groupEntries(before, groupId).includes(last);
}

function groupChange(before: BrowserState, after: BrowserState, groupId: string): GroupChange {
  const was = before.groups[groupId];
  const now = after.groups[groupId];
  if (!was || !now) return "other";
  const had = new Set(was.tabIds);
  const has = new Set(now.tabIds);
  const gone = was.tabIds.filter((id) => !has.has(id));
  const came = now.tabIds.filter((id) => !had.has(id));
  if (!gone.length && !came.length) return "same";
  const expanded = !was.collapsed && !now.collapsed;
  if (expanded && !came.length && gone.every((id) => !after.tabs[id])) return "extended";
  if (!expanded || gone.length || !came.every((id) => !before.tabs[id])) return "other";
  return groupGrowsAtEnd(before, after, groupId) ? "grown" : "extended";
}

type Core = {
  devKey: string;
  entries: string[];
  from: Capture;
  planner: Planner;
  height: (entry: string) => number;
  enabled: boolean;
  nativeTail: boolean;
  below?: ((delta: number) => void) | null;
};

function useMotion({ devKey, entries, from, planner, height, enabled, nativeTail, below }: Core) {
  const slides = useRef(new Map<string, Slide>()).current;
  const contexts = useRef(new Map<string, EntryMotion>()).current;
  const clipped = useRef(new Set<string>()).current;
  const watchers = useRef(new Map<string, Set<() => void>>()).current;
  const sources = useRef(new Map<string, ClipSource>()).current;
  const shown = useRef(new Set<string>()).current;
  const source = (key: string): ClipSource => {
    let known = sources.get(key);
    if (!known) {
      known = {
        clipped: () => clipped.has(key),
        subscribe: (changed) => {
          let set = watchers.get(key);
          if (!set) watchers.set(key, (set = new Set()));
          set.add(changed);
          return () => void set.delete(changed);
        },
      };
      sources.set(key, known);
    }
    return known;
  };
  const announce = () => {
    const changed = [...clipped].filter((k) => !shown.has(k)).concat([...shown].filter((k) => !clipped.has(k)));
    shown.clear();
    for (const key of clipped) shown.add(key);
    for (const key of changed) for (const notify of watchers.get(key) ?? []) notify();
  };
  const ghosts = useRef<Ghost[]>([]);
  const seen = useRef(entries);
  const latest = useRef(entries);
  latest.current = entries;
  const queued = useRef<Plan | null>(null);
  const clipping = useRef<object | null>(null);
  const [, rerender] = useState(0);
  if (enabled) devRegister("sidebarMotion", devKey, { slides, ghosts, clipped });

  const now = Date.now();
  for (const slide of slides.values()) {
    if (slide.until && now >= slide.until) {
      slide.until = 0;
      if (!slide.landed) slide.value.setValue(0);
    }
  }
  if (ghosts.current.some((g) => g.until && now >= g.until)) ghosts.current = ghosts.current.filter((g) => !g.until || now < g.until);

  const prepare = (plan: Plan, at: number) => {
    for (const m of plan.moves) if (!slides.has(m.key)) slides.set(m.key, { value: new Animated.Value(m.from), from: m.from, at, until: 0, landed: false });
    ghosts.current = [...ghosts.current, ...plan.ghosts];
    clipped.clear();
    for (const key of plan.clipped) clipped.add(key);
    queued.current = plan;
  };

  const before = from.pending;
  if (before) {
    from.pending = null;
    const plan = enabled ? planner(before, { state: workspaceSnapshot(), list: entries }, slides, ghosts.current, Date.now()) : null;
    if (plan) prepare(plan, Date.now());
  }
  if (entries !== seen.current) {
    seen.current = entries;
    const live = new Set(entries);
    for (const key of slides.keys()) if (key !== TAIL && !live.has(key)) slides.delete(key);
    for (const key of contexts.keys()) if (!live.has(key)) contexts.delete(key);
    for (const key of clipped) if (key !== TAIL && !live.has(key)) clipped.delete(key);
  }

  const slideBelow = useRef((entry: string, delta: number) => {
    const list = latest.current;
    const i = list.indexOf(entry);
    if (i < 0) return;
    const t = Date.now();
    const keys = [...list.slice(i + 1), TAIL];
    prepare({ moves: keys.map((key) => ({ key, from: shiftAt(slides.get(key), t) + delta })), ghosts: [], clipped: [list[i + 1] ?? TAIL], below: 0 }, t);
    rerender((n) => n + 1);
  }).current;

  useLayoutEffect(() => {
    const plan = queued.current;
    if (!plan) return;
    queued.current = null;
    const at = Date.now();
    const slideMs = SLIDE_MS * devScale();
    const token = plan.clipped.length ? {} : null;
    clipping.current = token;
    for (const [i, m] of plan.moves.entries()) {
      const slide = slides.get(m.key);
      if (!slide) continue;
      slide.value.setValue(m.from);
      slide.from = m.from;
      slide.at = at;
      slide.until = at + slideMs + FRAME_SLACK_MS;
      slide.landed = false;
      const timing = Animated.timing(slide.value, { toValue: 0, duration: slideMs, easing: SLIDE_EASING, useNativeDriver: nativeTail || m.key !== TAIL });
      const clips = i === 0 && token;
      timing.start(({ finished }) => {
        if (!finished) return;
        slide.landed = true;
        if (!clips) return;
        queueMicrotask(() => {
          if (clipping.current !== token) return;
          clipping.current = null;
          clipped.clear();
          announce();
        });
      });
    }
    for (const g of plan.ghosts) {
      g.until = at + FADE_MS * devScale() + FRAME_SLACK_MS;
      Animated.timing(g.opacity, { toValue: 0, duration: FADE_MS * devScale(), easing: FADE_EASING, useNativeDriver: true }).start();
    }
    announce();
    if (plan.below) below?.(plan.below);
  });

  const motion = (entry: string): EntryMotion | null => {
    const shift = slides.get(entry)?.value ?? null;
    const known = contexts.get(entry);
    if (!shift && !known && !clipped.has(entry)) return null;
    if (known && known.shift === shift) return known;
    const next = { shift, clip: source(entry) };
    contexts.set(entry, next);
    return next;
  };

  const slots = (list: string[]): ListSlot[] => {
    if (!ghosts.current.length) return list.map((entry) => ({ entry }));
    const place = (ghost: Ghost, top: number): ListSlot => ({ ghost, top });
    const byAnchor = new Map<string | null, Ghost[]>();
    for (const g of ghosts.current) byAnchor.set(g.anchor, [...(byAnchor.get(g.anchor) ?? []), g]);
    const out: ListSlot[] = [];
    let y = 0;
    let shown = 0;
    for (const entry of entries) {
      const here = byAnchor.get(entry);
      const mounted = shown < list.length && list[shown] === entry;
      if (here && mounted) for (const ghost of here) out.push(place(ghost, ghost.y - y));
      if (mounted) {
        out.push({ entry });
        shown++;
      }
      if (here) byAnchor.delete(entry);
      y += height(entry) + GAP;
    }
    for (const left of byAnchor.values()) for (const ghost of left) if (!ghost.anchor || !entries.includes(ghost.anchor)) out.push(place(ghost, ghost.y - y));
    return out;
  };

  return { motion, slots, fading: ghosts.current.length > 0, slideBelow, tail: slides.get(TAIL)?.value ?? null, tailClip: source(TAIL) };
}

export function useListMotion(windowId: string, profileId: string, entries: string[], from: Capture, enabled: boolean) {
  const height: Height = (s, e) => entryHeight(s, windowId, profileId, e);
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const changes = new Map<string, GroupChange>();
    if (before.state.groups !== after.state.groups) {
      const had = new Set(before.list);
      for (const e of after.list) {
        const groupId = entryId(e, "group");
        if (!had.has(e) || groupId === null) continue;
        const change = groupChange(before.state, after.state, groupId);
        if (change === "other" && height(before.state, e) !== height(after.state, e)) return null;
        if (change === "grown" || change === "extended") changes.set(e, change);
      }
    }
    const start = changes.size ? 0 : sharedPrefix(before.list, after.list);
    const had = new Set(before.list.slice(start));
    const kept = new Set(after.list.slice(start));
    const removed = before.list.slice(start).filter((e) => !kept.has(e));
    const added = after.list.slice(start).filter((e) => !had.has(e));
    if (!removed.length && !added.length && !changes.size) return null;
    if (!removed.every(closedIn(before.state, after.state)) || !added.every(openedIn(before.state, after.state))) return null;
    const grown = [...changes].flatMap(([e, c]) => (c === "grown" ? [e] : []));
    if (!removed.length && !added.length && !grown.length) return null;
    const now: Height = (s, e) => (changes.get(e) === "extended" ? height(before.state, e) : height(s, e));
    const base = prefixHeight(after.state, after.list, start, now);
    const old = offsets(before.state, before.list, height, start, base);
    const next = offsets(after.state, after.list, now, start, base);
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e);
    return buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: true, snapshot, clipAfter: grown, start });
  };
  return useMotion({ devKey: windowId, entries, from, planner, height: (e) => height(workspaceSnapshot(), e), enabled, nativeTail: true });
}

export function useGroupMotion(windowId: string, profileId: string, groupId: string, entries: string[], from: Capture, scope: ListMotionScope, enabled: boolean) {
  const height: Height = (s, e) => entryHeight(s, windowId, profileId, e);
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const was = before.state.groups[groupId];
    const now = after.state.groups[groupId];
    if (!was || !now || was.collapsed || now.collapsed) return null;
    const had = new Set(before.list);
    const kept = new Set(after.list);
    const removed = before.list.filter((e) => !kept.has(e));
    const added = after.list.filter((e) => !had.has(e));
    if (!removed.length === !added.length) return null;
    if (!removed.every(closedIn(before.state, after.state)) || !added.every(openedIn(before.state, after.state))) return null;
    const old = offsets(before.state, before.list, height);
    const next = offsets(after.state, after.list, height);
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e);
    const atEnd = !removed.length && groupGrowsAtEnd(before.state, after.state, groupId);
    const plan = buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: !atEnd, snapshot, clipAfter: [], start: 0 });
    if (!atEnd) return plan;
    return { ...(plan ?? { moves: [], ghosts: [], clipped: [] }), below: old.end - next.end };
  };
  const below = scope.slideBelow ? (delta: number) => scope.slideBelow?.(entryKey("group", groupId), delta) : null;
  return useMotion({ devKey: `${windowId}:${groupId}`, entries, from, planner, height: (e) => height(workspaceSnapshot(), e), enabled, nativeTail: false, below });
}

export const GhostSlot = memo(function GhostSlot({ snapshot, top, opacity }: { snapshot: EntrySnapshot; top: number; opacity: Animated.Value }) {
  const style = useMemo(() => ({ opacity }), [opacity]);
  const [fade, ref] = useAnimatedStyle(style);
  const theme = useTheme();
  return (
    <View pointerEvents="none" {...fade} ref={ref} style={[{ height: 0, marginBottom: -GAP }, fade.style as object]}>
      {ghostEntry(snapshot, theme, top)}
    </View>
  );
});

