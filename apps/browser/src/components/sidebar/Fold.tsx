import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";

const FOLD_MS = 150;
const FOLD_EASING = Easing.bezier(0.2, 0.9, 0.3, 1);

type FoldState = { open: Animated.Value; moving: boolean };

const FoldedAway = createContext(false);

export const useFoldedAway = () => useContext(FoldedAway);

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

export function Fold({
  fold,
  collapsed,
  entries,
  keep,
  gap,
  rowHeight,
  padTop = 0,
  padBottom = 0,
  indent = 0,
  mountClosed = false,
  footer,
}: {
  fold: FoldState;
  collapsed: boolean;
  entries: FoldEntry[];
  keep?: string | null;
  gap: number;
  rowHeight?: number | ((key: string) => number);
  padTop?: number;
  padBottom?: number;
  indent?: number;
  mountClosed?: boolean;
  footer?: ReactNode;
}) {
  const { open, moving } = fold;
  const parentAway = useContext(FoldedAway);
  const measuring = rowHeight === undefined;
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const styles = useRef(new Map<number, object>()).current;
  const kept = keep && entries.some((e) => e.key === keep) ? keep : null;
  const folding = !!kept && (collapsed || moving);
  const state = useRef({ moving, folding, kept });
  state.current = { moving, folding, kept };
  const heightOf = (key: string) => (typeof rowHeight === "function" ? rowHeight(key) : (rowHeight ?? measured[key] ?? 0));
  const rows = entries.filter((e) => !e.ghost);
  const total = rows.reduce((sum, e) => sum + heightOf(e.key), 0) + gap * Math.max(0, rows.length - 1) + padTop + padBottom;
  const foldingStyle = (height: number) => {
    let style = styles.get(height);
    if (!style) {
      style = {
        height: open.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
        marginBottom: open.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
        opacity: open,
        overflow: "hidden",
      };
      styles.set(height, style);
    }
    return style;
  };
  const closed = { height: 0, marginBottom: -gap, opacity: 0, overflow: "hidden" as const };
  const outer = folding
    ? null
    : moving
      ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, total] }), opacity: open, overflow: "hidden" as const }
      : collapsed
        ? { height: 0, opacity: 0, overflow: "hidden" as const }
        : null;
  const mountAll = !collapsed || moving || mountClosed || measuring;

  return (
    <Animated.View style={outer} pointerEvents={collapsed ? "box-none" : "auto"}>
      <View style={[{ gap, paddingTop: padTop, paddingBottom: padBottom, paddingLeft: indent }, measuring && outer && !moving ? { position: "absolute", left: 0, right: 0, top: 0 } : null]}>
        {entries.map(({ key, node }) => {
          const stays = key === kept;
          if (!stays && !mountAll) return null;
          return (
            <FoldedAway.Provider key={key} value={parentAway || ((collapsed || moving) && !stays)}>
              <Animated.View style={folding && !stays ? (moving ? foldingStyle(heightOf(key)) : closed) : null} pointerEvents={collapsed && !stays ? "none" : "auto"}>
                {measuring ? (
                  <View
                    onLayout={(e) => {
                      if (state.current.moving || (state.current.folding && key !== state.current.kept)) return;
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
      </View>
    </Animated.View>
  );
}
