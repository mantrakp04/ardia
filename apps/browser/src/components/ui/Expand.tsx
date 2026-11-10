import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Animated, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { crossfade, reveal } from "./motion";
import { reduceMotion } from "./reduceMotion";

export function Expand({ open, appear = false, animate = true, gap = 0, onClosed, children }: { open: boolean; appear?: boolean; animate?: boolean; gap?: number; onClosed?: () => void; children: ReactNode }) {
  const kept = useRef(children);
  if (open) kept.current = children;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const startedOpen = useRef(open).current;
  const animateFirst = appear || !startedOpen;
  const height = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(startedOpen && !appear ? 1 : 0)).current;
  const [measured, setMeasured] = useState<number | null>(null);
  const driven = useRef(false);
  const target = useRef<number | null>(null);
  const run = useRef<Animated.CompositeAnimation | null>(null);
  const closed = useRef(onClosed);
  closed.current = onClosed;

  const settle = (to: number, growing: boolean, done?: () => void) => {
    run.current?.stop();
    const fadeTo = open ? 1 : 0;
    if (!animate) {
      height.setValue(to);
      fade.setValue(fadeTo);
      return done?.();
    }
    const fading = Animated.timing(fade, { toValue: fadeTo, ...(open ? reveal.fadeIn : reveal.fadeOut), useNativeDriver: true });
    if (reduceMotion() === true) {
      if (open) height.setValue(to);
      run.current = fading;
      return fading.start(({ finished }) => {
        if (!finished) return;
        height.setValue(to);
        done?.();
      });
    }
    run.current = Animated.parallel([fading, Animated.timing(height, { toValue: to, ...(growing ? reveal.grow : reveal.shrink), useNativeDriver: false })]);
    run.current.start(({ finished }) => finished && done?.());
  };

  useEffect(() => () => run.current?.stop(), []);

  useEffect(() => {
    if (measured === null) return void (!open && setMounted(false));
    const to = open ? measured : 0;
    if (!driven.current) {
      driven.current = true;
      target.current = to;
      if (animateFirst) return settle(to, true);
      height.setValue(to);
      return;
    }
    if (target.current === to) return;
    const growing = to > (target.current ?? 0);
    target.current = to;
    settle(to, growing, open ? undefined : () => {
      setMounted(false);
      closed.current?.();
    });
  }, [open, measured]);

  if (!mounted) return null;
  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    if (!driven.current && !animateFirst) height.setValue(next);
    setMeasured(next);
  };
  const sized = measured !== null;
  const pull = gap ? (sized ? { marginTop: height.interpolate({ inputRange: [0, Math.max(1, measured)], outputRange: [-gap, 0], extrapolate: "clamp" }) } : animateFirst ? { marginTop: -gap } : null) : null;
  return (
    <Animated.View pointerEvents={open ? "auto" : "none"} style={[sized ? { height, overflow: "hidden" } : animateFirst ? COLLAPSED : undefined, pull]}>
      <Animated.View onLayout={onLayout} style={{ opacity: fade }}>
        {open ? children : kept.current}
      </Animated.View>
    </Animated.View>
  );
}

const COLLAPSED = { height: 0, overflow: "hidden" } as const;

export type PresentItem<T> = { key: string; item: T; present: boolean; appear: boolean };

export function useListPresence<T>(items: readonly T[], keyOf: (item: T) => string) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const born = useRef<Set<string> | null>(null);
  if (!born.current && items.length) born.current = new Set(items.map(keyOf));
  const last = useRef(items);
  const leaving = useRef(new Map<string, { item: T; index: number }>());
  if (last.current !== items) {
    const now = new Set(items.map(keyOf));
    last.current.forEach((item, index) => {
      const key = keyOf(item);
      if (!now.has(key) && !leaving.current.has(key)) leaving.current.set(key, { item, index });
    });
    for (const key of now) leaving.current.delete(key);
    last.current = items;
  }
  const list: PresentItem<T>[] = items.map((item) => {
    const key = keyOf(item);
    return { key, item, present: true, appear: !!born.current && !born.current.has(key) };
  });
  for (const [key, { item, index }] of leaving.current) list.splice(Math.min(index, list.length), 0, { key, item, present: false, appear: false });
  const drop = (key: string) => {
    if (leaving.current.delete(key)) rerender();
  };
  return { list, drop };
}

export function Crossfade({ id, children, reserve, align = "center", style }: { id: string; children: ReactNode; reserve?: ReactNode; align?: "center" | "flex-start"; style?: StyleProp<ViewStyle> }) {
  const fade = useRef(new Animated.Value(1)).current;
  const latest = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  const turns = useRef(0);
  const [leaving, setLeaving] = useState<{ node: ReactNode; turn: number } | null>(null);
  if (latest.current.id !== id) {
    turns.current += 1;
    fade.setValue(0);
    setLeaving({ node: latest.current.node, turn: turns.current });
  }
  latest.current = { id, node: children };
  useEffect(() => {
    if (!leaving) return;
    const turn = leaving.turn;
    const run = Animated.timing(fade, { toValue: 1, ...crossfade, useNativeDriver: true });
    run.start(({ finished }) => finished && setLeaving((l) => (l?.turn === turn ? null : l)));
    return () => run.stop();
  }, [leaving?.turn]);
  return (
    <View style={style}>
      {reserve ? (
        <View pointerEvents="none" style={RESERVE}>
          {reserve}
        </View>
      ) : null}
      <Animated.View style={{ opacity: fade, alignItems: align }}>{children}</Animated.View>
      {leaving ? (
        <Animated.View pointerEvents="none" style={[OVERLAY, { alignItems: align, opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          {leaving.node}
        </Animated.View>
      ) : null}
    </View>
  );
}

const RESERVE = { height: 0, opacity: 0, overflow: "hidden" } as const;
const OVERLAY = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "center" } as const;
