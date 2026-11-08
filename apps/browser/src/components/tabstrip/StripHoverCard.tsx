import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, View } from "react-native";
import { displayUrl } from "@ardia/core";
import { useTab } from "../../state/browser/hooks";
import { tabTitle } from "../../state/browser/model";
import { useIsSleeping } from "../../state/tabs/tabLifecycle";
import { awayTitle } from "../../state/pins/organize";
import { stripChipEntered, stripChipGone, stripChipLeft, stripChipPressed, useStripHover } from "../../state/tabs/stripHover";
import { markHoverProps } from "../../lib/hoverMarks";
import { FadeLabel, font, HoverCard as HoverPanel, space, Symbol, Text } from "../ui";
import { lineHeight } from "../ui/tokens";
import { useTheme } from "../ui/theme";
import { TabIcon } from "../sidebar/TabIcon";
import { AwayTitleLabel } from "../sidebar/AwayTitle";
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
  const theme = useTheme();
  const tab = useTab(tabId);
  const sleeping = useIsSleeping(tabId);
  if (!tab) return null;
  const away = awayTitle(tab);
  return (
    <HoverPanel width={STRIP_CARD_WIDTH} pad="ml">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        {away ? (
          <AwayTitleLabel away={away} color={theme.textPrimary} fontSize={font.body.fontSize} weight="medium" height={18} style={{ flex: 1 }} />
        ) : (
          <FadeLabel text={tabTitle(tab)} fontSize={font.body.fontSize} weight="medium" color={theme.textPrimary} style={{ flex: 1, height: 18 }} />
        )}
      </View>
      {tab.url ? (
        <Text lines={2} size="caption" tone="textSecondary" style={URL_LINE}>
          {displayUrl(tab.url)}
        </Text>
      ) : null}
      {sleeping ? (
        <View accessible accessibilityLabel="Web content has been discarded" style={{ flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs }}>
          <Symbol name="moon.zzz" size={10} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
          <Text size="caption" tone="textTertiary">
            This tab needs to reload
          </Text>
        </View>
      ) : null}
    </HoverPanel>
  );
}

const URL_LINE = { marginTop: space.xs, lineHeight: lineHeight.caption } as const;
