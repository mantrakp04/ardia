import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { closeTab } from "../../state/browser/actions";
import { COMPLETION_MS, openLiveItem } from "../../state/live/engine";
import { prBadge } from "../../state/live/github";
import { SOURCES } from "../../state/live/sources";
import { useLive } from "../../state/live/store";
import type { CompletedItem, LiveItem } from "../../state/live/types";
import { usePageProfileId } from "../../state/browser/hooks";
import { useIsActiveIn, useLiveItemTab } from "../../state/sidebar/hooks";
import { HoverSlot } from "../ui/HoverSlot";
import { Button, ContextMenuArea, FadeLabel, font, ink, radius, Surface, Symbol, weight } from "../ui";
import { curve } from "../ui/motion";
import { hex, layout, useTheme } from "../ui/theme";
import { useLiveColors, type LiveColors } from "../live/tokens";
import { modifiersOf } from "../../lib/keys";
import { dismissHover } from "../../state/sidebar/hover";
import { useRowHover } from "./hoverController";
import { openLiveItemMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { TabIcon } from "./TabIcon";
import { SELECTED_ROW_SHADOW_OFFSET, SIDEBAR_MOTION, SIDEBAR_TYPE, sidebarTokens, TABULAR_NUMS } from "./tokens";
import { useSelectedTabGlow, useSidebarRowLook } from "./rowLook";

const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

export function LiveItemRow({ folderId, item, windowId, inStack = false }: { folderId: string; item: LiveItem; windowId: string; inStack?: boolean }) {
  const indent = inStack ? 10 : 0;
  const theme = useTheme();
  const { closeTabHint: closeHint } = useSidebarRowLook();
  const glow = useSelectedTabGlow();
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
      Animated.timing(fold, { toValue: 0, duration: SIDEBAR_MOTION.liveFold, easing: curve.fold, useNativeDriver: false }),
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
              <Surface
                fill={hex(!active && pressed ? theme.tabPressed : fill)}
                cornerRadius={radius.card}
                borderWidth={active ? 1 : 0}
                borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
                shadowColor={active ? glow.shadowColor : undefined}
                shadowOpacity={active ? glow.shadowOpacity : 0}
                shadowRadius={glow.shadowRadius}
                shadowOffset={SELECTED_ROW_SHADOW_OFFSET}
                style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9 + indent, paddingRight: 6 }}
              >
                {unread ? <View style={{ position: "absolute", left: 2 + indent, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.accent }} /> : null}
                <ItemIcon item={item} completion={completion} colors={colors} />
                <FadeLabel
                  text={item.title}
                  fontSize={font.body.fontSize}
                  weight={unread ? "medium" : undefined}
                  color={active ? theme.tabSelectedText : completion ? theme.textSecondary : theme.textTab}
                  style={{ flex: 1, height: 18, marginLeft: 5 }}
                />
                {inStack && item.pr?.stack ? <PositionChip position={item.pr.stack.position} /> : null}
                <HoverSlot
                  hovered={hovered && !!tabId && !completion}
                  width={22}
                  reserve={inStack && item.pr?.stack ? "always" : "hover"}
                  hover={<Button variant="icon" icon="xmark" size={10} weight="semibold" box={22} radius={radius.m} onPress={() => tabId && void closeTab(tabId)} tooltip={withShortcut("Close Tab", closeHint)} />}
                >
                  <Trailing item={item} completion={completion} colors={colors} />
                </HoverSlot>
              </Surface>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function PositionChip({ position }: { position: number }) {
  const theme = useTheme();
  const colors = useLiveColors();
  return (
    <View style={{ minWidth: 16, height: 16, borderRadius: radius.field, paddingHorizontal: 4, marginLeft: 4, backgroundColor: colors.chip, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: SIDEBAR_TYPE.count, fontWeight: weight.semibold, color: theme.textSecondary, fontVariant: TABULAR_NUMS }}>{position}</Text>
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
    Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 14, useNativeDriver: true }).start();
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

function Trailing({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }): ReactNode {
  const theme = useTheme();
  if (completion) {
    return <Text style={{ ...font.caption, fontWeight: weight.medium, color: colors[COMPLETION_GLYPH[completion].color], marginRight: 4 }}>{completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}</Text>;
  }
  const badge = item.pr ? prBadge(item.pr) : null;
  if (!badge) return null;
  const spec = BADGES[badge];
  return (
    <View tooltip={spec.tip} style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={11} weight="semibold" color={colors[spec.color]} style={{ width: 16, height: 16 }} />
      ) : (
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors[spec.color], borderWidth: 0.5, borderColor: sidebarTokens(theme).liveDotRing }} />
      )}
    </View>
  );
}
