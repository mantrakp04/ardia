import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { webviews } from "../../lib/webviews";
import type { Rect } from "../layout/geometry";
import { dragRect, paneUnder, type Point } from "./captureGeometry";
import { endCapture, useCapture } from "./captureState";

const SHADE = "rgba(0,0,0,0.3)";

export function CaptureOverlay({ windowId, panes, origin, width, height }: {
  windowId: string;
  panes: Record<string, Rect>;
  origin: { x: number; y: number } | null;
  width: number;
  height: number;
}) {
  const active = useCapture((c) => c.windowId === windowId);
  const shownTab = useBrowser((s) => activeTabId(s, windowId));
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const keys = useRef<View>(null);
  const latest = useRef({ panes, origin, width, height });
  latest.current = { panes, origin, width, height };

  const wasActive = useRef(false);
  useEffect(() => {
    if (active) keys.current?.focus();
    else {
      setDrag(null);
      const shown = wasActive.current && activeTabId(useBrowser.getState(), windowId);
      if (shown) void webviews.get(shown)?.focus();
    }
    wasActive.current = active;
  }, [active, windowId]);
  useEffect(() => () => endCapture(windowId), [windowId]);
  useEffect(() => endCapture(windowId), [shownTab, windowId]);

  const gesture = useRef<{ from: Point; page: Point } | null>(null);
  const pointer = (e: GestureResponderEvent) => ({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  const dragTo = (e: GestureResponderEvent): Point | null => {
    const g = gesture.current;
    if (!g) return null;
    const p = pointer(e);
    return { x: g.from.x + p.x - g.page.x, y: g.from.y + p.y - g.page.y };
  };
  const begin = (e: GestureResponderEvent) => {
    const from = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    gesture.current = { from, page: pointer(e) };
    setDrag({ from, to: from });
  };
  const move = (e: GestureResponderEvent) => {
    const to = dragTo(e);
    if (to) setDrag({ from: gesture.current!.from, to });
  };
  const finish = (e: GestureResponderEvent) => {
    const start = gesture.current?.from;
    const to = dragTo(e);
    gesture.current = null;
    setDrag(null);
    endCapture(windowId);
    const { panes, origin, width, height } = latest.current;
    if (!start || !to || !origin) return;
    const picked = paneUnder(dragRect(start, to, { width, height }), panes);
    if (!picked) return;
    const { x, y, width: w, height: h } = picked.rect;
    void webviews.get(picked.tabId)?.copyRegionToPasteboard([origin.x + x, origin.y + y, w, h]);
  };

  if (!active || width <= 0) return null;
  const r = drag ? dragRect(drag.from, drag.to, { width, height }) : null;
  return (
    <Pressable
      ref={keys}
      focusable
      enableFocusRing={false}
      keyDownEvents={[{ key: "Escape" }]}
      onKeyDown={(e) => {
        if (e.nativeEvent.key === "Escape") endCapture(windowId);
      }}
      accessibilityLabel="Drag to capture an area of the page"
      onPressIn={begin}
      // @ts-expect-error
      onPressMove={move}
      onPressOut={finish}
      style={[StyleSheet.absoluteFill, { cursor: "crosshair" }]}
    >
      {r ? (
        <>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height: r.y, backgroundColor: SHADE }} />
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: r.y + r.height, width, bottom: 0, backgroundColor: SHADE }} />
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: r.y, width: r.x, height: r.height, backgroundColor: SHADE }} />
          <View pointerEvents="none" style={{ position: "absolute", left: r.x + r.width, top: r.y, right: 0, height: r.height, backgroundColor: SHADE }} />
          <View pointerEvents="none" style={{ position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height, borderWidth: 1, borderColor: "white" }} />
          <Text pointerEvents="none" style={[styles.size, { left: r.x, top: r.y + r.height + 6 }]}>
            {Math.round(r.width)} × {Math.round(r.height)}
          </Text>
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SHADE, alignItems: "center", justifyContent: "center" }]}>
          <Text style={styles.hint}>Drag to copy an area · Esc to cancel</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, fontWeight: "600", color: "white", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, overflow: "hidden" },
  size: { position: "absolute", fontSize: 11, fontWeight: "600", color: "white", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: "hidden" },
});
