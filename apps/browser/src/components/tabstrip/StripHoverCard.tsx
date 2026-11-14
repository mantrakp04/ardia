import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, View } from "react-native";
import { useTab } from "../../state/browser/hooks";
import { stripChipEntered, stripChipGone, stripChipLeft, stripChipPressed, useStripHover } from "../../state/tabs/stripHover";
import { HoverCard as HoverPanel, useOffstage } from "../ui";
import { TabCardSummary } from "../sidebar/TabCardSummary";
import { useHoverCardMotion, useHoverCardPlacement } from "../sidebar/hoverMotion";
import type { ChipHover } from "./reachableHover";
import { STRIP_CARD_GAP, STRIP_CARD_MARGIN, STRIP_CARD_WIDTH } from "./tokens";

export function useStripCardHover(windowId: string, tabId: string, view: RefObject<View | null>, hover: ChipHover) {
  const reachable = !useOffstage();
  const latest = useRef({ windowId, tabId, reachable });
  latest.current = { windowId, tabId, reachable };
  useEffect(() => {
    const measure = () =>
      new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
        const node = view.current;
        if (!node) return resolve(null);
        node.measureInWindow((x, y, width, height) => resolve(width > 0 ? { x, y, width, height } : null));
      });
    const follow = () => {
      const { windowId, tabId, reachable } = latest.current;
      if (hover.hovered()) stripChipEntered(windowId, tabId, measure);
      else if (reachable) stripChipLeft(windowId, tabId);
      else stripChipGone(windowId, tabId);
    };
    const unsubscribe = hover.subscribe(follow);
    if (hover.hovered()) follow();
    return unsubscribe;
  }, [hover]);
  useEffect(() => () => stripChipGone(latest.current.windowId, latest.current.tabId), []);
  return useState(() => ({ onTouchStart: () => stripChipPressed(latest.current.tabId) }))[0];
}

export function StripHoverCard({ windowId, stripBottom, windowWidth }: { windowId: string; stripBottom: number; windowWidth: number }) {
  const hover = useStripHover((s) => (s.hover?.windowId === windowId ? s.hover : null));
  const { drawn, motion } = useHoverCardMotion(`strip:${windowId}`, hover);
  const [height, setHeight] = useState(0);
  const origin = useMemo(() => ({ x: 0, top: 0 }), []);
  useHoverCardPlacement(motion, drawn ? origin : null, { width: STRIP_CARD_WIDTH, height });
  if (!drawn) return null;
  const left = Math.max(STRIP_CARD_MARGIN, Math.min(drawn.anchor.x, windowWidth - STRIP_CARD_WIDTH - STRIP_CARD_MARGIN));
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={[{ position: "absolute", left, top: stripBottom + STRIP_CARD_GAP, width: STRIP_CARD_WIDTH }, motion.style]}
    >
      <StripCardContent tabId={drawn.tabId} />
    </Animated.View>
  );
}

function StripCardContent({ tabId }: { tabId: string }) {
  const tab = useTab(tabId);
  if (!tab) return null;
  return (
    <HoverPanel width={STRIP_CARD_WIDTH} pad="ml">
      <TabCardSummary tab={tab} />
    </HoverPanel>
  );
}
