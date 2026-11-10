import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, View } from "react-native";
import { useTab } from "../../state/browser/hooks";
import { stripChipEntered, stripChipGone, stripChipLeft, stripChipPressed, useStripHover } from "../../state/tabs/stripHover";
import { markHoverProps } from "../../lib/hoverMarks";
import { HoverCard as HoverPanel } from "../ui";
import { TabCardSummary } from "../sidebar/TabCardSummary";
import { useHoverCardMotion, useHoverCardPlacement } from "../sidebar/hoverMotion";
import { STRIP_CARD_GAP, STRIP_CARD_MARGIN, STRIP_CARD_WIDTH } from "./tokens";

export function useStripCardHover(windowId: string, tabId: string, view: RefObject<View | null>) {
  const latest = useRef({ windowId, tabId });
  latest.current = { windowId, tabId };
  const [props] = useState(() => {
    const measure = () =>
      new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
        const node = view.current;
        if (!node) return resolve(null);
        node.measureInWindow((x, y, width, height) => resolve(width > 0 ? { x, y, width, height } : null));
      });
    return {
      ...markHoverProps({
        onMouseEnter: () => stripChipEntered(latest.current.windowId, latest.current.tabId, measure),
        onMouseLeave: () => stripChipLeft(latest.current.windowId, latest.current.tabId),
      }),
      onTouchStart: () => stripChipPressed(latest.current.tabId),
    };
  });
  useEffect(() => () => stripChipGone(latest.current.windowId, latest.current.tabId), []);
  return props;
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
