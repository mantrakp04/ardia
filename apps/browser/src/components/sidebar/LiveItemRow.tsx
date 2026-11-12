import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";
import { closeTab } from "../../state/browser/actions";
import { COMPLETION_MS, openLiveItem, returnLiveTab } from "../../state/live/engine";
import { prBadge } from "../../state/live/github";
import { SOURCES } from "../../state/live/sources";
import { hideItems, useLive } from "../../state/live/store";
import type { CompletedItem, LiveItem } from "../../state/live/types";
import { usePageProfileId } from "../../state/browser/hooks";
import { useIsActiveIn, useLiveItemTab, useLiveTabOpen, useTabAwayFromPin } from "../../state/sidebar/hooks";
import type { CloseControl } from "../../state/sidebar/closeControl";
import { noteLiveRowHide } from "../../state/telemetry/liveHides";
import { HoverSlot } from "../ui/HoverSlot";
import { Badge, Button, ContextMenuArea, Dot, hairline, ink, Symbol, Text, useHover } from "../ui";
import { curve, springs } from "../ui/motion";
import { useTheme } from "../ui/theme";
import { useLiveColors, type LiveColors } from "../live/tokens";
import { modifiersOf } from "../../lib/keys";
import { dismissHover } from "../../state/sidebar/hover";
import { useRowHover } from "./hoverController";
import { openLiveItemMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_MOTION, sidebarTokens } from "./tokens";
import { useSidebarScale } from "./scale";
import { useSidebarRowLook } from "./rowLook";
import { SidebarRowLabel, SidebarRowSurface } from "./SidebarRow";

const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

export function LiveItemRow({ folderId, item, windowId, inStack = false }: { folderId: string; item: LiveItem; windowId: string; inStack?: boolean }) {
  const m = useSidebarScale();
  const indent = inStack ? m.px(STACK_INDENT) : 0;
  const theme = useTheme();
  const { closeTabHint: closeHint, backToPinHint } = useSidebarRowLook();
  const backToPin = useHover();
  const colors = useLiveColors();
  const key = liveRowKey(folderId, item.id);
  const profileId = usePageProfileId();
  const tabId = useLiveItemTab(windowId, profileId, folderId, item.id);
  const active = useIsActiveIn(windowId, profileId, tabId);
  const away = useTabAwayFromPin(tabId);
  const tabOpen = useLiveTabOpen(folderId, [item.id]);
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
  const resettable = away && !completion;
  const resetting = resettable && backToPin.hovered;
  const control = liveRowControl(folderId, item, tabId, tabOpen, closeHint);

  return (
    <Animated.View style={completion ? { height: fold.interpolate({ inputRange: [0, 1], outputRange: [0, m.rowHeight] }), opacity: fold, overflow: "hidden" } : null}>
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
              <SidebarRowSurface fill={!active && pressed ? theme.tabPressed : fill} selected={active} border={active ? 1 : 0} padLeft={m.tabRow.contentLeft + indent}>
                {unread ? <Dot size={m.px(UNREAD_DOT)} color={theme.accent} style={{ position: "absolute", left: m.px(UNREAD_DOT_LEFT) + indent }} /> : null}
                <View {...backToPin.hoverProps}>
                  {resettable ? (
                    <Pressable
                      onPress={() => tabId && returnLiveTab(tabId)}
                      tooltip={withShortcut("Back to Pinned URL", backToPinHint)}
                      accessibilityRole="button"
                      accessibilityLabel="Back to Pinned URL"
                    >
                      {resetting ? (
                        <Symbol name="arrow.uturn.backward" size={m.glyph.s} weight="semibold" color={active ? theme.rowSelectedText : theme.textTab} style={{ width: m.icon, height: m.icon }} />
                      ) : (
                        <ItemIcon item={item} completion={completion} colors={colors} />
                      )}
                    </Pressable>
                  ) : (
                    <ItemIcon item={item} completion={completion} colors={colors} />
                  )}
                </View>
                <SidebarRowLabel
                  text={resetting ? "Back to Pinned URL" : item.title}
                  weight={unread ? "medium" : undefined}
                  color={active ? theme.rowSelectedText : completion ? theme.textSecondary : theme.textTab}
                />
                {inStack && item.pr?.stack ? <PositionChip position={item.pr.stack.position} /> : null}
                <HoverSlot
                  hovered={hovered && !!control && !completion}
                  reserve={inStack && item.pr?.stack ? "always" : "hover"}
                  width={m.rowButton.box}
                  hover={control ? <Button variant="icon" icon={control.icon} box={m.rowButton.box} glyph={m.rowButton.glyph} weight="semibold" onPress={control.press} tooltip={control.tooltip} /> : null}
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

const UNREAD_DOT = 5;
const UNREAD_DOT_LEFT = 2;
const STACK_INDENT = 10;
const ITEM_GLYPH = { completion: 14, pullRequest: 12, badge: 11, dot: 7 } as const;

type LiveRowControl = CloseControl & { press(): void };

function liveRowControl(folderId: string, item: LiveItem, tabId: string | null, tabOpen: boolean, closeHint: string | undefined): LiveRowControl | null {
  if (tabId) return { icon: "minus", tooltip: withShortcut("Close Tab", closeHint), press: () => void closeTab(tabId) };
  if (item.pr && !tabOpen)
    return {
      icon: "xmark",
      tooltip: "Hide Until Refresh",
      press: () => {
        hideItems(folderId, [item]);
        noteLiveRowHide();
      },
    };
  return null;
}

function PositionChip({ position }: { position: number }) {
  const m = useSidebarScale();
  return (
    <View style={{ marginLeft: m.space.xs }}>
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
  const m = useSidebarScale();
  const pop = useRef(new Animated.Value(completion ? 0 : 1)).current;
  useEffect(() => {
    if (!completion) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, ...springs.bouncy, useNativeDriver: true }).start();
  }, [completion]);
  if (completion) {
    const glyph = COMPLETION_GLYPH[completion];
    return (
      <Animated.View style={{ width: m.icon, height: m.icon, alignItems: "center", justifyContent: "center", transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
        <Symbol name={glyph.symbol} size={m.px(ITEM_GLYPH.completion)} weight="semibold" color={colors[glyph.color]} style={{ width: m.icon, height: m.icon }} />
      </Animated.View>
    );
  }
  if (item.pr) {
    return <Symbol name="arrow.triangle.pull" size={m.px(ITEM_GLYPH.pullRequest)} weight="semibold" color={item.pr.draft ? colors.draft : colors.success} style={{ width: m.icon, height: m.icon }} />;
  }
  if (item.icon && /^https?:/.test(item.icon)) return <TabIcon url={item.url} favicon={item.icon} direct size={m.icon} />;
  return <TabIcon url={item.source === "confluence" && !item.icon ? SOURCES.confluence.site : item.url} icon={item.icon} size={m.icon} />;
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
  const m = useSidebarScale();
  if (completion) {
    return (
      <Text size="caption" weight="medium" color={colors[COMPLETION_GLYPH[completion].color]} style={{ fontSize: m.font.caption, marginRight: m.space.xs }}>
        {completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}
      </Text>
    );
  }
  const badge = item.pr ? prBadge(item.pr) : null;
  if (!badge) return null;
  const spec = BADGES[badge];
  return (
    <View tooltip={spec.tip} style={{ width: m.tabRow.closeSlot, height: m.tabRow.closeSlot, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={m.px(ITEM_GLYPH.badge)} weight="semibold" color={colors[spec.color]} style={{ width: m.icon, height: m.icon }} />
      ) : (
        <Dot size={m.px(ITEM_GLYPH.dot)} color={colors[spec.color]} ring={sidebarTokens(theme).liveDotRing} ringWidth={hairline.ring} />
      )}
    </View>
  );
}
