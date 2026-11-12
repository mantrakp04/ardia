import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { curve, currentValue } from "../ui/motion";
import { layout } from "../ui/theme";
import { noteSidebarCount } from "../../state/telemetry/usage";
import { FoldedAway } from "./hoverController";
import { devScale } from "./ListMotion";
import { SIDEBAR_MOTION } from "./tokens";

const FOLD_MS = SIDEBAR_MOTION.fold;
const FOLD_EASING = curve.enter;
const TURN_MS = SIDEBAR_MOTION.listSlide;
const TURN_EASING = curve.cssEase;
const GAP = layout.rowGap;

type FoldState = { open: Animated.Value; moving: boolean };

export function useFold(collapsed: boolean): FoldState {
  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [settled, setSettled] = useState(collapsed);
  const [running, setRunning] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRunning(true);
    const animation = Animated.timing(open, { toValue: collapsed ? 0 : 1, duration: FOLD_MS, easing: FOLD_EASING, useNativeDriver: false });
    animation.start(({ finished }) => {
      if (!finished) return;
      setSettled(collapsed);
      setRunning(false);
    });
    return () => animation.stop();
  }, [collapsed]);
  return { open, moving: running || settled !== collapsed };
}

export type FoldEntry = { key: string; node: ReactNode; ghost?: boolean };

type Leaving = { node: ReactNode; before: string | null };
type Turn = { value: Animated.Value; to: 0 | 1; done: boolean; at: number; from: number; height: number; leaving?: Leaving };
type Shown = { settled: boolean; keys: string[]; order: string[]; turns: ReadonlyMap<string, Turn>; pad: Turn | null };

const NO_TURNS: ReadonlyMap<string, Turn> = new Map();

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((key, i) => key === b[i]);

const heightAt = (turn: Turn, v: number) =>
  v <= turn.at ? (turn.at ? (turn.from * v) / turn.at : 0) : turn.from + ((turn.height - turn.from) * (v - turn.at)) / (1 - turn.at);

function turnTo(turn: Turn | null | undefined, to: 0 | 1, height: number): Turn {
  if (!turn) return { value: new Animated.Value(1 - to), to, done: false, at: 1 - to, from: to ? 0 : height, height };
  if (turn.to === to && !turn.leaving) return turn;
  const at = currentValue(turn.value);
  const from = heightAt(turn, at);
  return { value: turn.value, to, done: false, at, from, height: to ? height : from };
}

const foldStyle = (value: Animated.Value, height: number) => ({
  height: value.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
  marginBottom: value.interpolate({ inputRange: [0, 1], outputRange: [-GAP, 0] }),
  opacity: value,
  overflow: "hidden" as const,
});

type Farewell = (key: string) => { node: ReactNode; height: number } | null;

function nextShown(was: Shown, settled: boolean, keys: string[], order: string[], farewell: Farewell | undefined, heightOf: (key: string) => number, lastHeight: (key: string) => number | undefined): Shown {
  if (!settled || !was.settled) return { settled, keys, order, turns: NO_TURNS, pad: null };
  const had = new Set(was.keys);
  const has = new Set(keys);
  const live = new Set(order);
  const turns = new Map(was.turns);
  for (const key of keys) if (!had.has(key)) turns.set(key, turnTo(turns.get(key), 1, heightOf(key)));
  for (const key of was.keys) {
    if (has.has(key)) continue;
    if (live.has(key)) {
      turns.set(key, turnTo(turns.get(key), 0, lastHeight(key) ?? heightOf(key)));
      continue;
    }
    const gone = farewell?.(key);
    if (!gone?.height) {
      turns.delete(key);
      continue;
    }
    const before = was.order.slice(was.order.indexOf(key) + 1).find((k) => live.has(k)) ?? null;
    turns.set(key, { ...turnTo(turns.get(key), 0, gone.height), leaving: { node: gone.node, before } });
  }
  for (const [key, turn] of turns) if ((turn.height <= 0 && turn.from <= 0) || turn.at === turn.to) turns.delete(key);
  const showing = keys.length > 0;
  const wasShowing = was.pad ? was.pad.to === 1 : was.keys.length > 0;
  return { settled, keys, order, turns, pad: showing === wasShowing ? was.pad : turnTo(was.pad, showing ? 1 : 0, 1) };
}

function swept(shown: Shown): Shown {
  const turns = new Map([...shown.turns].filter(([, turn]) => !turn.done));
  const pad = shown.pad?.done && !turns.size ? null : shown.pad;
  return turns.size === shown.turns.size && pad === shown.pad ? shown : { ...shown, turns, pad };
}

export function Fold({
  fold,
  collapsed,
  entries,
  keep,
  rowHeight,
  estimate,
  padTop = 0,
  padBottom = 0,
  indent = 0,
  indentEnd = 0,
  mountClosed = false,
  footer,
  farewell,
}: {
  fold: FoldState;
  collapsed: boolean;
  entries: FoldEntry[];
  keep?: string | string[] | null;
  rowHeight?: number | ((key: string) => number);
  estimate?: (key: string) => number;
  padTop?: number | ((first: string | undefined) => number);
  padBottom?: number;
  indent?: number;
  indentEnd?: number;
  mountClosed?: boolean;
  footer?: ReactNode;
  farewell?: Farewell;
}) {
  const { open, moving } = fold;
  const parentAway = useContext(FoldedAway);
  const measuring = rowHeight === undefined;
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const styles = useRef(new Map<number, object>()).current;
  const turnStyles = useRef(new WeakMap<Turn, object>()).current;
  const runs = useRef(new Map<Turn, Animated.CompositeAnimation>()).current;
  const seen = useRef<ReadonlyMap<string, number>>(new Map());
  const laidOut = useRef(new Map<string, number>()).current;
  const kept = new Set([keep ?? []].flat().filter((key) => entries.some((e) => e.key === key)));
  const heightOf = (key: string) => (typeof rowHeight === "function" ? rowHeight(key) : (rowHeight ?? measured[key] ?? estimate?.(key) ?? 0));
  const order = entries.flatMap((e) => (e.ghost ? [] : [e.key]));
  const keys = order.filter((key) => kept.has(key));
  const settledShut = collapsed && !moving;
  const [tracked, setTracked] = useState<Shown>(() => ({ settled: settledShut, keys, order, turns: NO_TURNS, pad: null }));
  let shown = tracked;
  if (tracked.settled !== settledShut || (settledShut && (!sameKeys(tracked.keys, keys) || !sameKeys(tracked.order, order)))) {
    shown = nextShown(tracked, settledShut, keys, order, farewell, heightOf, (key) => laidOut.get(key) ?? seen.current.get(key));
    setTracked(shown);
  }
  seen.current = new Map(keys.map((key) => [key, heightOf(key)]));
  for (const key of laidOut.keys()) if (!kept.has(key) || shown.turns.has(key)) laidOut.delete(key);
  const turning = shown.turns.size > 0 || shown.pad !== null;
  const folding = (kept.size > 0 || turning) && (collapsed || moving);
  const state = useRef({ moving, folding, kept, turns: shown.turns });
  state.current = { moving, folding, kept, turns: shown.turns };

  useLayoutEffect(() => {
    const live = new Set(tracked.turns.values());
    if (tracked.pad) live.add(tracked.pad);
    for (const [turn, run] of runs) {
      if (live.has(turn)) continue;
      if (!turn.done) run.stop();
      runs.delete(turn);
    }
    for (const turn of live) {
      if (turn.done || runs.has(turn)) continue;
      if (turn !== tracked.pad) noteSidebarCount("keptRowFolds");
      const run = Animated.timing(turn.value, { toValue: turn.to, duration: TURN_MS * devScale(), easing: TURN_EASING, useNativeDriver: false });
      runs.set(turn, run);
      run.start(({ finished }) => {
        if (!finished) return;
        turn.done = true;
        setTracked(swept);
      });
    }
  }, [tracked]);
  useEffect(() => () => runs.forEach((run) => run.stop()), []);

  const live = new Set(order);
  const leaving = [...shown.turns].flatMap(([key, turn]) => (turn.leaving && !live.has(key) ? [{ key, node: turn.leaving.node, before: turn.leaving.before }] : []));
  const rows: FoldEntry[] = [];
  for (const entry of entries) {
    for (const gone of leaving) if (gone.before === entry.key) rows.push(gone);
    rows.push(entry);
  }
  for (const gone of leaving) if (gone.before === null || !live.has(gone.before)) rows.push(gone);
  const firstShown = rows.find((e) => !e.ghost && (kept.has(e.key) || shown.turns.has(e.key)))?.key;
  const top = typeof padTop === "function" ? padTop(collapsed && firstShown ? firstShown : order[0]) : padTop;
  const listed = entries.filter((e) => !e.ghost);
  const total = listed.reduce((sum, e) => sum + heightOf(e.key), 0) + GAP * Math.max(0, listed.length - 1) + top + padBottom;
  const foldingStyle = (height: number) => {
    let style = styles.get(height);
    if (!style) styles.set(height, (style = foldStyle(open, height)));
    return style;
  };
  const turnStyle = (turn: Turn) => {
    let style = turnStyles.get(turn);
    if (!style) {
      turnStyles.set(turn, (style = {
        height: turn.value.interpolate({ inputRange: [0, turn.at, 1], outputRange: [0, turn.from, turn.height] }),
        marginBottom: turn.value.interpolate({ inputRange: [0, 1], outputRange: [-GAP, 0] }),
        opacity: turn.value,
        overflow: "hidden" as const,
      }));
    }
    return style;
  };
  const pads = shown.pad
    ? { paddingTop: shown.pad.value.interpolate({ inputRange: [0, 1], outputRange: [0, top] }), paddingBottom: shown.pad.value.interpolate({ inputRange: [0, 1], outputRange: [0, padBottom] }) }
    : { paddingTop: top, paddingBottom: padBottom };
  const closed = { height: 0, marginBottom: -GAP, opacity: 0, overflow: "hidden" as const };
  const outer = folding
    ? null
    : moving
      ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, total] }), opacity: open, overflow: "hidden" as const }
      : collapsed
        ? { height: 0, opacity: 0, overflow: "hidden" as const }
        : null;
  const mountAll = !collapsed || moving || mountClosed || (measuring && !estimate);

  return (
    <Animated.View style={outer} pointerEvents={collapsed ? "box-none" : "auto"}>
      <Animated.View style={[{ gap: GAP, paddingLeft: indent, paddingRight: indentEnd }, pads, measuring && outer && !moving ? { position: "absolute", left: 0, right: 0, top: 0 } : null]}>
        {rows.map(({ key, node }) => {
          const stays = kept.has(key);
          const turn = shown.turns.get(key);
          if (!stays && !mountAll && !turn) return null;
          return (
            <FoldedAway.Provider key={key} value={parentAway || ((collapsed || moving) && !stays)}>
              <Animated.View
                style={turn ? turnStyle(turn) : folding && !stays ? (moving ? foldingStyle(heightOf(key)) : closed) : null}
                pointerEvents={collapsed && !stays ? "none" : "auto"}
                onLayout={collapsed && stays && !turn ? (e) => void laidOut.set(key, e.nativeEvent.layout.height) : undefined}
              >
                {measuring ? (
                  <View
                    onLayout={(e) => {
                      if (state.current.moving || state.current.turns.has(key) || (state.current.folding && !state.current.kept.has(key))) return;
                      const height = e.nativeEvent.layout.height;
                      setMeasured((all) => (all[key] === height ? all : { ...all, [key]: height }));
                    }}
                  >
                    {node}
                  </View>
                ) : (
                  node
                )}
              </Animated.View>
            </FoldedAway.Provider>
          );
        })}
        {footer}
      </Animated.View>
    </Animated.View>
  );
}
