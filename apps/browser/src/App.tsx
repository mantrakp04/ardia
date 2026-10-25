import { WindowBackdrop } from "@ardia/shaders";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { CommandPanel } from "./components/CommandPanel";
import { ContentCard } from "./components/ContentCard";
import { BookmarkDialog } from "./components/bookmarks/BookmarkDialog";
import { EditBookmarkDialog } from "./components/bookmarks/EditBookmarkDialog";
import { ExtensionOverlays } from "./components/extensions/ExtensionOverlays";
import { ExtensionSidePanel } from "./components/extensions/SidePanel";
import { DownloadMagnet, DownloadsPopover } from "./components/Downloads";
import { UtilityWindow } from "./components/settings/UtilityWindow";
import { isUtilityWindowId } from "./components/settings/windows";
import { OnboardingOverlay } from "./components/onboarding";
import { CreateProfileHost } from "./components/profiles/CreateProfile";
import { useFullscreenTab } from "./components/layout/pageState";
import { ProfileTint } from "./components/layout/ProfileSwipe";
import { TOP_CARD_INSET, TOP_STRIP_HEIGHT, TopStripPeek, TopTabStrip } from "./components/layout/TopTabStrip";
import { cardInset, useAddressBarInSidebar, useTabLayout } from "./components/layout/windowLayout";
import { WindowProfile } from "./components/layout/WindowProfile";
import { DockedLayout } from "./components/layout/SidebarDock";
import { LittleArdiaWindow } from "./components/littleArdia/LittleArdiaWindow";
import { SidebarOverlays } from "./components/sidebar/Overlays";
import { ThemeScope, useTheme } from "./lib/theme";
import { useBrowser } from "./store/browser";
import { useWindowId, WindowContext } from "./store/hooks";

export function WindowRoot({ windowId }: { windowId?: string }) {
  if (isUtilityWindowId(windowId))
    return (
      <ThemeScope>
        <UtilityWindow id={windowId!} />
      </ThemeScope>
    );
  return <BrowserWindowRoot windowId={windowId} />;
}

function BrowserWindowRoot({ windowId }: { windowId?: string }) {
  const id = useBrowser((s) => windowId ?? s.ui.focusedWindowId ?? s.windowOrder[0] ?? null);
  const exists = useBrowser((s) => !!id && !!s.windows[id]);
  const small = useBrowser((s) => !!id && s.windows[id]?.kind === "small");
  if (!id || !exists) return null;
  return (
    <WindowContext.Provider value={id}>
      <ThemeScope>{small ? <LittleArdiaWindow /> : <BrowserWindow />}</ThemeScope>
    </WindowContext.Provider>
  );
}

function BrowserWindow() {
  const theme = useTheme();
  const windowId = useWindowId();
  const topTabs = useTabLayout() === "top";
  const showStrip = useBrowser((s) => topTabs && !!s.windows[windowId]?.sidebarOpen);
  const fullscreen = !!useFullscreenTab(windowId);
  const arcLayout = useAddressBarInSidebar();
  const [width, setWidth] = useState(0);
  const card = (
    <>
      <ContentCard />
      {!fullscreen && <ExtensionSidePanel />}
    </>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
      <WindowProfile />
      <ProfileTint />
      <DockedLayout
        fullscreen={fullscreen}
        topTabs={topTabs}
        inset={
          showStrip
            ? { top: TOP_STRIP_HEIGHT, right: TOP_CARD_INSET, bottom: TOP_CARD_INSET, left: TOP_CARD_INSET }
            : cardInset(arcLayout)
        }
      >
        {card}
      </DockedLayout>
      {showStrip && (
        <View pointerEvents={fullscreen ? "none" : "auto"} style={[{ position: "absolute", left: 0, right: 0 }, fullscreen ? { bottom: "100%" } : { top: 0 }]}>
          <TopTabStrip width={width} hidden={fullscreen} />
        </View>
      )}
      {topTabs && !showStrip && <TopStripPeek windowWidth={width} enabled={!fullscreen} />}
      <CommandPanel windowWidth={width} />
      <DownloadsPopover />
      <ExtensionOverlays />
      <DownloadMagnet />
      <BookmarkDialog />
      <EditBookmarkDialog />
      <CreateProfileHost />
      <SidebarOverlays windowWidth={width} />
      <OnboardingOverlay />
    </View>
  );
}
