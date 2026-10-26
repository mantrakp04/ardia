import { WindowBackdrop } from "./components/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { CommandPanel } from "./components/omnibox/CommandPanel";
import { ContentCard } from "./components/window/ContentCard";
import { BookmarkDialog } from "./components/bookmarks/BookmarkDialog";
import { EditBookmarkDialog } from "./components/bookmarks/EditBookmarkDialog";
import { ExtensionOverlays } from "./components/extensions/ExtensionOverlays";
import { ExtensionSidePanel } from "./components/extensions/SidePanel";
import { DownloadMagnet, DownloadsPopover } from "./components/downloads/Downloads";
import { UtilityWindow } from "./components/settings/UtilityWindow";
import { isUtilityWindowId } from "./state/settings/settingsWindows";
import { OnboardingOverlay } from "./components/onboarding";
import { CreateProfileHost } from "./components/profiles/CreateProfile";
import { useFullscreenTab } from "./state/tabs/pageState";
import { ProfileTint } from "./components/window/ProfileSwipe";
import { TOP_CARD_INSET, TOP_STRIP_HEIGHT, TopStripPeek, TopTabStrip } from "./components/tabstrip/TopTabStrip";
import { useTabLayout } from "./state/windows/layout";
import { WindowProfile } from "./components/window/WindowProfile";
import { DockedLayout } from "./components/window/SidebarDock";
import { LittleArdiaWindow } from "./components/littleArdia/LittleArdiaWindow";
import { SidebarOverlays } from "./components/sidebar/Overlays";
import { layout, profileAccent, profileTheme, useTheme } from "./components/ui/theme";
import { ThemeScope } from "./components/window/ThemeScope";
import { useBrowser } from "./state/browser/store";
import { useWindowId, WindowContext } from "./state/browser/hooks";
import { provideProfileLooks } from "./state/profiles/looks";

provideProfileLooks({ accent: profileAccent, theme: profileTheme });

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
  const fullscreen = !!useFullscreenTab(windowId);
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
        inset={topTabs ? { top: TOP_STRIP_HEIGHT, right: TOP_CARD_INSET, bottom: TOP_CARD_INSET, left: TOP_CARD_INSET } : { top: layout.cardTop, right: layout.cardInset, bottom: layout.cardInset, left: layout.cardInset }}
        topStrip={
          topTabs
            ? { strip: <TopTabStrip width={width} hidden={fullscreen} />, peek: <TopStripPeek windowWidth={width} enabled={!fullscreen} /> }
            : undefined
        }
      >
        {card}
      </DockedLayout>
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
