import { WindowBackdrop, ContextMenuArea, WindowDragRegion, useHover } from "../ui";
import { setTrafficLightsCenter } from "../../state/windows/nativeWindow";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useProfileOrder } from "../../state/profiles/hooks";
import { openPanel } from "../../state/windows/actions";
import { useActiveTab, useWindowId, useWindowProfile, useWindowUi } from "../../state/browser/hooks";
import type { Tab } from "../../state/browser/types";
import { CommandPanel } from "../omnibox/CommandPanel";
import { ContentCard } from "../window/ContentCard";
import { DownloadsPopover } from "../downloads/Downloads";
import { ExtensionOverlays } from "../extensions/ExtensionOverlays";
import { ToolbarPopupAnchor } from "../extensions/ToolbarExtensions";
import { setUrlAnchor } from "../../state/windows/layout";
import { showUrlBarMenu } from "../../state/omnibox/paste";
import { copyPageUrl } from "../../state/site/selection";
import { ProfileBadge } from "../profiles/ProfileIcons";
import { openInMainWindow, openLittleArdiaProfileMenu } from "../../state/littleArdia/actions";
import { PageLabel, SMALL_BAR_BUTTON, SMALL_INSET, SmallBar, SmallBarBadgeButton } from "./SmallChrome";
import { SMALL_BAR_HEIGHT, SMALL_LIGHTS_CENTER } from "../../state/windows/small";

const FIELD_LEFT = 84;

export function LittleArdiaWindow() {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, flexDirection: "row", paddingTop: SMALL_BAR_HEIGHT, paddingLeft: SMALL_INSET, paddingRight: SMALL_INSET, paddingBottom: SMALL_INSET }}>
        <ContentCard />
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        <LittleArdiaBar />
      </View>
      <CommandPanel windowWidth={width} />
      <DownloadsPopover />
      <ExtensionOverlays />
    </View>
  );
}

function LittleArdiaBar() {
  const windowId = useWindowId();
  const tab = useActiveTab();
  const panelOpen = useWindowUi().panel.open;
  const severalProfiles = useProfileOrder((order) => order.length > 1);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    void setTrafficLightsCenter(windowId, SMALL_LIGHTS_CENTER);
  }, [windowId]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = () => {
    if (!tab?.url) return;
    void copyPageUrl(tab.id);
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <SmallBar
      fieldLeft={FIELD_LEFT}
      field={tab ? <PageField tab={tab} windowId={windowId} hidden={panelOpen} /> : null}
      buttons={[
        { icon: copied ? "checkmark" : "link", size: 14, disabled: !tab?.url, tooltip: "Copy Link (⇧⌘C)", onPress: copy },
        { icon: "arrow.up.left.and.arrow.down.right", size: 13, tooltip: "Open in Ardia (⌘O)", onPress: () => openInMainWindow(windowId) },
      ]}
      trailing={severalProfiles ? <ProfileButton windowId={windowId} /> : undefined}
    >
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      {tab ? <ToolbarPopupAnchor windowId={windowId} tabId={tab.id} top={(SMALL_BAR_HEIGHT - SMALL_BAR_BUTTON) / 2} right={SMALL_INSET} /> : null}
    </SmallBar>
  );
}

function ProfileButton({ windowId }: { windowId: string }) {
  const profile = useWindowProfile();
  return (
    <SmallBarBadgeButton tooltip={`Profile: ${profile.name}`} onPress={() => void openLittleArdiaProfileMenu(windowId)}>
      <ProfileBadge profile={profile} size={16} />
    </SmallBarBadgeButton>
  );
}

function PageField({ tab, windowId, hidden }: { tab: Tab; windowId: string; hidden: boolean }) {
  const { hovered, hoverProps } = useHover();
  const field = useRef<View>(null);
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View ref={field} onLayout={anchor} {...hoverProps} style={{ flex: 1, opacity: hidden ? 0 : 1 }}>
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => tab.url && void showUrlBarMenu(tab)}>
        <WindowDragRegion
          clickable
          accessibilityRole="button"
          onRegionClick={() => openPanel(windowId, tab.url)}
          style={{ flex: 1 }}
        >
          <PageLabel tab={tab} hovered={hovered} />
        </WindowDragRegion>
      </ContextMenuArea>
    </View>
  );
}
