import { useLayoutEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { displayUrl } from "@ardia/core";
import { useTheme } from "../ui/theme";
import { useIsBookmarked, useTab } from "../../state/browser/hooks";
import { plural, tabTitle } from "../../state/browser/model";
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
import { FadeLabel, font, HoverCard as HoverPanel, space, Symbol, Text } from "../ui";
import { lineHeight } from "../ui/tokens";
import { ActionTile } from "../site/SiteControlsParts";
import { SectionLabel } from "./SectionLabel";
import { SidebarListRow, SidebarRowLabel } from "./SidebarRow";
import { clickTab, toggleBookmarkInWindow } from "../../state/sidebar/actions";
import { GroupPanel } from "./GroupPanel";
import { dismissHover, setHoverSpace } from "../../state/sidebar/hover";
import { cardHoverProps } from "./hoverController";
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
  return (
    <HoverPanel {...cardHoverProps} width={WIDTH} pad="ml" style={{ position: "absolute", ...hoverCardOrigin(anchor) }}>
      {children}
    </HoverPanel>
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <FadeLabel text={tabTitle(tab)} fontSize={font.body.fontSize} weight="medium" color={theme.textPrimary} style={{ flex: 1, height: 18 }} />
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
      {away && tab.pinnedUrl ? (
        <Text lines={1} size="caption" tone="textTertiary" style={PINNED_LINE}>
          Pinned: {displayUrl(tab.pinnedUrl)}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.m }}>
        <ActionTile caption icon={tab.pin ? "pin.slash" : "pin"} label={tab.pin ? "Unpin" : "Pin"} onPress={() => togglePin(tabId)} />
        {tab.url ? (
          <ActionTile caption
            icon={bookmarked ? "bookmark.fill" : "bookmark"}
            label={bookmarked ? "Bookmarked" : "Bookmark"}
            onPress={() => toggleBookmarkInWindow(windowId, { url: tab.url, title: tabTitle(tab), favicon: tab.favicon })}
          />
        ) : null}
        {!isActive && !tab.pin ? (
          <ActionTile caption
            icon="rectangle.split.2x1"
            label="Split"
            onPress={() => {
              dismissHover();
              openInSplit(tabId);
            }}
          />
        ) : null}
        {video ? <ActionTile caption icon={pip ? "pip.exit" : "pip.enter"} label={pip ? "Exit PiP" : "PiP"} onPress={togglePip} /> : null}
        {away ? (
          <ActionTile caption
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

const URL_LINE = { marginTop: space.xs, lineHeight: lineHeight.caption } as const;
const PINNED_LINE = { marginTop: space.xxs } as const;
const MORE_LINE = { marginTop: space.xs, marginLeft: space.xs } as const;

const PEEK_ROWS = 8;

function FolderPeek({ folderId, windowId, anchor }: { folderId: string; windowId: string; anchor: Anchor }) {
  const members = useTileFolderMembers(windowId, folderId);
  const label = useTileFolderLabel(windowId, folderId);
  const open = useFolderPanel((u) => u.open?.windowId === windowId && u.open.folderId === folderId);
  if (open || !members.length) return null;
  const more = members.length - PEEK_ROWS;
  return (
    <Card anchor={anchor}>
      <SectionLabel title={`${label} · ${plural(members.length, "tab")}`} inset={space.xs} bottom={space.xs} />
      {members.slice(0, PEEK_ROWS).map((id) => (
        <PeekRow key={id} tabId={id} windowId={windowId} />
      ))}
      {more > 0 ? (
        <Text size="caption" tone="textTertiary" style={MORE_LINE}>
          and {more} more
        </Text>
      ) : null}
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
      <View onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <SidebarListRow height={28} padRight={space.xs} fill={hovered ? theme.rowHover : undefined}>
          <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} compact profileId={tab.profileId} />
          <SidebarRowLabel text={tabTitle(tab)} color={theme.textTab} compact />
        </SidebarListRow>
      </View>
    </Pressable>
  );
}
