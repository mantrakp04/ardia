import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";
import { closeTab } from "../../state/browser/actions";
import { COMPLETION_MS, openLiveItem } from "../../state/live/engine";
import { prBadge } from "../../state/live/github";
import { SOURCES } from "../../state/live/sources";
import { useLive } from "../../state/live/store";
import type { CompletedItem, LiveItem } from "../../state/live/types";
import { usePageProfileId } from "../../state/browser/hooks";
import { useIsActiveIn, useLiveItemTab } from "../../state/sidebar/hooks";
import { HoverSlot } from "../ui/HoverSlot";
import { Badge, Button, ContextMenuArea, Dot, hairline, ink, space, Symbol, Text } from "../ui";
import { curve, springs } from "../ui/motion";
import { layout, useTheme } from "../ui/theme";
import { useLiveColors, type LiveColors } from "../live/tokens";
import { modifiersOf } from "../../lib/keys";
import { dismissHover } from "../../state/sidebar/hover";
import { useRowHover } from "./hoverController";
import { openLiveItemMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_MOTION, sidebarTokens, TAB_ROW } from "./tokens";
import { useSidebarRowLook } from "./rowLook";
import { SidebarRowLabel, SidebarRowSurface } from "./SidebarRow";

const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

export function LiveItemRow({ folderId, item, windowId, inStack = false }: { folderId: string; item: LiveItem; windowId: string; inStack?: boolean }) {
  const indent = inStack ? STACK_INDENT : 0;
  const theme = useTheme();
  const { closeTabHint: closeHint } = useSidebarRowLook();
  const colors = useLiveColors();
  const key = liveRowKey(folderId, item.id);
  const profileId = usePageProfileId();
  const tabId = useLiveItemTab(windowId, profileId, folderId, item.id);
  const active = useIsActiveIn(windowId, profileId, tabId);
  const unread = useLive((s) => !!s.unread[folderId]?.includes(item.id));
  const completion = useLive((s) => (s.completing[folderId]?.includes(item.id) ? (s.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null));
  const { hovered, hoverProps } = useRowHover(windowId, completion ? null : { kind: "live", id: key });
  const fold = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!completion) return;
    fold.setValue(1);
    Animated.sequence([
      Animated.delay(COMPLETION_MS - 420),
      Animated.timing(fold, { toValue: 0, duration: SIDEBAR_MOTION.liveFold, easing: curve.enter, useNativeDriver: false }),
    ]).start();
  }, [completion]);
  const fill = active ? theme.tabSelected : hovered ? theme.tabHover : ink.clear;

  return (
    <Animated.View style={completion ? { height: fold.interpolate({ inputRange: [0, 1], outputRange: [0, layout.rowHeight] }), opacity: fold, overflow: "hidden" } : null}>
      <View ref={(v) => registerRow(windowId, key, v)} {...hoverProps}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveItemMenu(windowId, folderId, item, tabId);
          }}
        >
          <Pressable
            onPress={(e) => {
              dismissHover();
              openLiveItem(windowId, folderId, item, { background: modifiersOf(e).metaKey });
            }}
          >
            {({ pressed }) => (
              <SidebarRowSurface fill={!active && pressed ? theme.tabPressed : fill} selected={active} border={active ? 1 : 0} padLeft={TAB_ROW.contentLeft + indent}>
                {unread ? <Dot size={5} color={theme.accent} style={{ position: "absolute", left: UNREAD_DOT_LEFT + indent }} /> : null}
                <ItemIcon item={item} completion={completion} colors={colors} />
                <SidebarRowLabel text={item.title} weight={unread ? "medium" : undefined} color={active ? theme.tabSelectedText : completion ? theme.textSecondary : theme.textTab} />
                {inStack && item.pr?.stack ? <PositionChip position={item.pr.stack.position} /> : null}
                <HoverSlot
                  hovered={hovered && !!tabId && !completion}
                  reserve={inStack && item.pr?.stack ? "always" : "hover"}
                  hover={<Button variant="icon" icon="xmark" size="s" weight="semibold" onPress={() => tabId && void closeTab(tabId)} tooltip={withShortcut("Close Tab", closeHint)} />}
                >
                  <Trailing item={item} completion={completion} colors={colors} />
                </HoverSlot>
              </SidebarRowSurface>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

const UNREAD_DOT_LEFT = 2;
const STACK_INDENT = 10;
const POSITION_CHIP = { marginLeft: space.xs } as const;

function PositionChip({ position }: { position: number }) {
  return (
    <View style={POSITION_CHIP}>
      <Badge text={position} tone="chip" size="m" />
    </View>
  );
}

export const COMPLETION_GLYPH: Record<CompletedItem["state"], { symbol: string; color: keyof LiveColors }> = {
  merged: { symbol: "checkmark.circle.fill", color: "merged" },
  reviewed: { symbol: "checkmark.circle.fill", color: "success" },
  closed: { symbol: "xmark.circle.fill", color: "draft" },
};

function ItemIcon({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }) {
  const pop = useRef(new Animated.Value(completion ? 0 : 1)).current;
  useEffect(() => {
    if (!completion) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, ...springs.bouncy, useNativeDriver: true }).start();
  }, [completion]);
  if (completion) {
    const glyph = COMPLETION_GLYPH[completion];
    return (
      <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
        <Symbol name={glyph.symbol} size={14} weight="semibold" color={colors[glyph.color]} style={{ width: 16, height: 16 }} />
      </Animated.View>
    );
  }
  if (item.pr) {
    return <Symbol name="arrow.triangle.pull" size={12} weight="semibold" color={item.pr.draft ? colors.draft : colors.success} style={{ width: 16, height: 16 }} />;
  }
  if (item.icon && /^https?:/.test(item.icon)) return <TabIcon url={item.url} favicon={item.icon} direct />;
  return <TabIcon url={item.source === "confluence" && !item.icon ? SOURCES.confluence.site : item.url} icon={item.icon} />;
}

const BADGES: Record<NonNullable<ReturnType<typeof prBadge>>, { symbol: string | null; color: keyof LiveColors; tip: string }> = {
  conflict: { symbol: "exclamationmark.triangle.fill", color: "conflict", tip: "Merge conflicts" },
  failing: { symbol: "xmark.circle.fill", color: "failure", tip: "Checks are failing" },
  changesRequested: { symbol: "arrow.uturn.backward.circle.fill", color: "failure", tip: "Changes Requested" },
  pending: { symbol: null, color: "pending", tip: "Some checks haven't completed yet" },
  approved: { symbol: "checkmark.circle.fill", color: "success", tip: "Approved" },
  passed: { symbol: "checkmark", color: "success", tip: "All checks have passed" },
};

const COMPLETION_LABEL = { marginRight: space.xs } as const;

function Trailing({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }): ReactNode {
  const theme = useTheme();
  if (completion) {
    return (
      <Text size="caption" weight="medium" color={colors[COMPLETION_GLYPH[completion].color]} style={COMPLETION_LABEL}>
        {completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}
      </Text>
    );
  }
  const badge = item.pr ? prBadge(item.pr) : null;
  if (!badge) return null;
  const spec = BADGES[badge];
  return (
    <View tooltip={spec.tip} style={{ width: TAB_ROW.closeSlot, height: TAB_ROW.closeSlot, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={11} weight="semibold" color={colors[spec.color]} style={{ width: 16, height: 16 }} />
      ) : (
        <Dot size={7} color={colors[spec.color]} ring={sidebarTokens(theme).liveDotRing} ringWidth={hairline.ring} />
      )}
    </View>
  );
}
