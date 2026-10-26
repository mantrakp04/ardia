import { useLayoutEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type GestureResponderEvent } from "react-native";
import { displayUrl } from "@ardia/core";
import { useTheme } from "../ui/theme";
import { useIsBookmarked, useTab } from "../../state/browser/hooks";
import { plural } from "../../state/browser/model";
import { useTileFolderLabel, useTileFolderMembers } from "../../state/pins/hooks";
import { returnToPinnedUrl } from "../../state/pins/actions";
import { togglePin } from "../../state/tabs/actions";
import { useHoverOrphaned, useIsShownTab } from "../../state/sidebar/hooks";
import { useFolderPanel } from "../../state/sidebar/tileFolderUi";
import { awayFromPin } from "../../state/pins/organize";
import { openInSplit } from "../../state/splits/actions";
import { CalendarPreview, useIsCalendarTab } from "../live/CalendarPreview";
import { LiveItemCard } from "../live/LiveItemCard";
import { useIsSleeping } from "../../state/tabs/tabLifecycle";
import { FadeLabel, font, Panel, radius, Symbol, useHover, weight } from "../ui";
import { SIDEBAR_SHADOW, SIDEBAR_TYPE } from "./tokens";
import { clickTab, tabTitle, toggleBookmarkInWindow } from "../../state/sidebar/actions";
import { GroupPanel } from "./GroupPanel";
import { cardHoverProps, dismissHover, setHoverSpace } from "../../state/sidebar/hover";
import { hoverCardOrigin, useHoverCardMotion, useHoverCardPlacement } from "./hoverMotion";
import { useSidebarUi, type Anchor, type Hover } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { HoverPlayer, usePlayerEdge, useShowsMiniPlayer } from "../media/HoverPlayer";
import { useMedia, usePictureInPicture } from "../../state/media/media";

const WIDTH = 264;

export function HoverCard({ windowId, width, height }: { windowId: string; width: number; height: number }) {
  const hover = useSidebarUi((u) => (u.hover?.windowId === windowId ? u.hover : null));
  const orphaned = useHoverOrphaned(windowId, hover);
  useLayoutEffect(() => {
    if (orphaned) dismissHover();
  }, [orphaned]);
  useLayoutEffect(() => setHoverSpace(windowId, height), [windowId, height]);
  const target = orphaned ? null : hover;
  const { drawn, leaving, entering, motion } = useHoverCardMotion(windowId, target);
  const shown = drawn ?? target;
  const player = useShowsMiniPlayer(shown?.kind === "tab" ? shown.id : undefined);
  const edge = usePlayerEdge(windowId, shown?.anchor);
  useHoverCardPlacement(motion, shown ? hoverCardOrigin(shown.anchor, player ? edge : undefined) : null, { width, height });
  if (!shown) return null;
  return (
    <Animated.View pointerEvents={leaving || entering ? "none" : "box-none"} style={[StyleSheet.absoluteFill, motion.style]}>
      <HoverContent hover={shown} windowId={windowId} player={player} windowHeight={height} />
    </Animated.View>
  );
}

function HoverContent({ hover, windowId, player, windowHeight }: { hover: Hover; windowId: string; player: boolean; windowHeight: number }) {
  const calendar = useIsCalendarTab(hover.kind === "tab" ? hover.id : null);
  if (hover.kind === "live") return <LiveItemCard id={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "tab" && player) return <HoverPlayer tabId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "tab" && calendar) return <CalendarPreview tabId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "folder") return <FolderPeek folderId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  return hover.kind === "tab" ? <TabCard tabId={hover.id} windowId={windowId} anchor={hover.anchor} /> : <GroupPanel key={`${windowId}:${hover.id}`} groupId={hover.id} windowId={windowId} anchor={hover.anchor} windowHeight={windowHeight} />;
}

function Card({ anchor, children }: { anchor: Anchor; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Panel
      {...cardHoverProps}
      fill={theme.panel}
      radius={radius.panel}
      border={theme.panelBorder}
      shadow={SIDEBAR_SHADOW.card}
      style={{ position: "absolute", ...hoverCardOrigin(anchor), width: WIDTH, padding: 10 }}
    >
      {children}
    </Panel>
  );
}

function TabCard({ tabId, windowId, anchor }: { tabId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const isActive = useIsShownTab(windowId, tabId);
  const bookmarked = useIsBookmarked(tab?.url ?? "");
  const video = useMedia((m) => !!m.sessions[tabId]?.hasVideo || !!m.pipOpen[tabId]);
  const [pip, togglePip] = usePictureInPicture(tabId);
  const sleeping = useIsSleeping(tabId);
  if (!tab) return null;
  const away = awayFromPin(tab);
  return (
    <Card anchor={anchor}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <FadeLabel text={tabTitle(tab)} fontSize={font.body.fontSize} weight="medium" color={theme.textPrimary} style={{ flex: 1, height: 18 }} />
      </View>
      {tab.url ? (
        <Text numberOfLines={2} style={{ marginTop: 4, ...font.footnote, lineHeight: 15, color: theme.textSecondary }}>
          {displayUrl(tab.url)}
        </Text>
      ) : null}
      {sleeping ? (
        <View accessible accessibilityLabel="Web content has been discarded" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
          <Symbol name="moon.zzz" size={10} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
          <Text style={{ ...font.footnote, color: theme.textTertiary }}>This tab needs to reload</Text>
        </View>
      ) : null}
      {away && tab.pinnedUrl ? (
        <Text numberOfLines={1} style={{ marginTop: 2, ...font.footnote, color: theme.textTertiary }}>
          Pinned: {displayUrl(tab.pinnedUrl)}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
        <Action icon={tab.pinned ? "pin.slash" : "pin"} label={tab.pinned ? "Unpin" : "Pin"} onPress={() => togglePin(tabId)} />
        {tab.url ? (
          <Action
            icon={bookmarked ? "bookmark.fill" : "bookmark"}
            label={bookmarked ? "Bookmarked" : "Bookmark"}
            onPress={() => toggleBookmarkInWindow(windowId, { url: tab.url, title: tabTitle(tab), favicon: tab.favicon })}
          />
        ) : null}
        {!isActive && !tab.pinned ? (
          <Action
            icon="rectangle.split.2x1"
            label="Split"
            onPress={() => {
              dismissHover();
              openInSplit(tabId);
            }}
          />
        ) : null}
        {video ? <Action icon={pip ? "pip.exit" : "pip.enter"} label={pip ? "Exit PiP" : "PiP"} onPress={togglePip} /> : null}
        {away ? (
          <Action
            icon="arrow.uturn.backward"
            label="Reset"
            onPress={() => {
              dismissHover();
              returnToPinnedUrl(tabId);
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}

const ACTIVATE = [{ name: "activate" }];

function Action({ icon, label, onPress }: { icon: string; label: string; onPress(press: GestureResponderEvent | AccessibilityActionEvent): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ flex: 1 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={ACTIVATE}
        onAccessibilityAction={(event) => event.nativeEvent.actionName === "activate" && onPress(event)}
      >
        {({ pressed }) => (
          <View
            style={{
              height: 44,
              borderRadius: radius.l,
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill,
            }}
          >
            <Symbol name={icon} size={13} color={theme.icon} style={{ width: 18, height: 16 }} />
            <Text style={{ fontSize: SIDEBAR_TYPE.cardAction, color: theme.textSecondary }}>{label}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const PEEK_ROWS = 8;

function FolderPeek({ folderId, windowId, anchor }: { folderId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const members = useTileFolderMembers(windowId, folderId);
  const label = useTileFolderLabel(windowId, folderId);
  const open = useFolderPanel((u) => u.open?.windowId === windowId && u.open.folderId === folderId);
  if (open || !members.length) return null;
  const more = members.length - PEEK_ROWS;
  return (
    <Card anchor={anchor}>
      <Text style={{ ...font.small, fontWeight: weight.semibold, color: theme.textSecondary, marginBottom: 4, marginLeft: 4 }}>
        {label} · {plural(members.length, "tab")}
      </Text>
      {members.slice(0, PEEK_ROWS).map((id) => (
        <PeekRow key={id} tabId={id} windowId={windowId} />
      ))}
      {more > 0 ? <Text style={{ ...font.footnote, color: theme.textTertiary, marginTop: 4, marginLeft: 4 }}>and {more} more</Text> : null}
    </Card>
  );
}

function PeekRow({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const [hovered, setHovered] = useState(false);
  if (!tab) return null;
  return (
    <Pressable
      onPress={() => {
        dismissHover();
        clickTab(windowId, tabId);
      }}
    >
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ height: 28, borderRadius: radius.button, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, backgroundColor: hovered ? theme.rowHover : undefined }}
      >
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        <FadeLabel text={tabTitle(tab)} fontSize={SIDEBAR_TYPE.compact} color={theme.textTab} style={{ flex: 1, height: 17, marginLeft: 7 }} />
      </View>
    </Pressable>
  );
}
