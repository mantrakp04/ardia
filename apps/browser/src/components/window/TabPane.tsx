import { memo, useEffect, useLayoutEffect } from "react";
import { Animated, View } from "react-native";
import { layout } from "../ui/theme";
import { usePrewarm } from "../../state/tabs/prewarm";
import { activate } from "../../state/tabs/actions";
import { shallowEqual, useBrowserWhile, useStoreWhile, useTabValue } from "../../state/tabs/tabWatch";
import { useSettings } from "../../state/browser/hooks";
import { splitOf } from "../../state/splits/splits";
import type { Tab } from "../../state/browser/types";
import { BOOKMARKS_BAR_HEIGHT, BookmarksBar, bookmarksBarShown, type BookmarksBarMode } from "../bookmarks/BookmarksBar";
import type { Rect, ToolbarGeometry } from "./geometry";
import { patchPage, usePages } from "../../state/tabs/pageState";
import { SplitEmptyState } from "../split/SplitEmptyState";
import { NewTabPage } from "../ntp/NewTabPage";
import { EmptyCard } from "./EmptyCard";
import { InternalPage } from "../pages";
import { ShareBar } from "../media/ShareBar";
import { Toolbar, ToolbarBackdrop } from "../toolbar/Toolbar";
import { AutoHideBackdrop, AutoHideToolbar, useToolbarMode, useToolbarMotion } from "../toolbar/AutoHideToolbar";
import { publishPaneChrome } from "../toolbar/WindowToolbar";
import { revealToolbar } from "../../state/windows/toolbarAutoHide";
import { pageKey, TabWebView } from "./TabWebView";
import { PageOverlays } from "./PageOverlays";
import { useProfileTheme } from "./ThemeScope";

export const TabPane = memo(function TabPane({
  tabId,
  windowId,
  rect,
  fills,
  fullWidth,
  fullHeight,
  focused,
  inActiveSplit,
  fullscreen,
  covered,
  geometry,
  toolbar,
  autoHide,
  small,
  mounted,
  warm,
  barMode,
  windowToolbar,
  popovers,
  peekShown,
}: {
  tabId: string;
  windowId: string;
  rect: Rect | undefined;
  fills: boolean;
  fullWidth: number;
  fullHeight: number;
  focused: boolean;
  inActiveSplit: boolean;
  fullscreen: boolean;
  covered: boolean;
  geometry: ToolbarGeometry;
  toolbar: boolean;
  autoHide: boolean;
  small: boolean;
  mounted: boolean;
  warm: Rect | undefined;
  barMode: BookmarksBarMode;
  windowToolbar: boolean;
  popovers: boolean;
  peekShown: boolean;
}) {
  const visible = !!rect;
  const live = visible || !!warm;
  const own = useTabValue(tabId, paneTab, shallowEqual);
  const theme = useProfileTheme(own.profileId);
  const isNewTab = !own.url;
  const emptyCard = useSettings((st) => isNewTab && st.newTabOpens === "commandBar");
  const newTabShown = useStoreWhile(usePages, live, (s) => !!s.pages[tabId]?.newTabShown);
  const inSomeSplit = useBrowserWhile(!!warm, (s) => !!warm && !!splitOf(s, tabId));
  const inSplit = visible ? inActiveSplit : inSomeSplit;
  const frame = rect ?? warm ?? { x: 0, y: 0, width: fullWidth, height: fullHeight };
  useEffect(() => {
    if (visible && isNewTab && !mounted) patchPage(tabId, { wasNewTab: true });
  }, [visible, isNewTab, mounted]);
  const prewarmed = usePrewarm(visible && isNewTab && !emptyCard && !mounted && !small && !inSplit);
  const hideBar = autoHide && visible && !fullscreen;
  const mode = useToolbarMode(tabId, windowId, hideBar);
  const bookmarksBar = bookmarksBarShown(barMode, own.exists ? own : undefined) && !fullscreen && !inSplit && !small;
  const doc = pageKey(own.url);
  const autoLayout = autoHide && toolbar && !fullscreen;
  const motion = useToolbarMotion({ enabled: autoLayout, mode, height: frame.height, extra: bookmarksBar ? BOOKMARKS_BAR_HEIGHT : 0, doc });
  useEffect(() => {
    if (visible) revealToolbar(tabId);
  }, [visible]);
  const chromeInWindow = hideBar && windowToolbar;
  useLayoutEffect(() => {
    if (chromeInWindow) publishPaneChrome(windowId, { tabId, mode, bar: motion.bar, fade: motion.fade });
  });

  return (
    <View
      pointerEvents={visible && !covered ? "auto" : "none"}
      onTouchStart={() => {
        if (visible && !focused) activate(tabId);
      }}
      style={{
        position: "absolute",
        ...(fills ? { left: 0, top: 0, right: 0, bottom: 0 } : { left: frame.x, top: frame.y, width: frame.width, height: frame.height }),
        borderRadius: fullscreen ? 0 : layout.cardRadius,
        overflow: "hidden",
        opacity: covered ? 0 : 1,
        backgroundColor: visible && !fullscreen ? theme.card : undefined,
      }}
    >
      {!toolbar || fullscreen || autoLayout ? null : visible && !windowToolbar ? (
        <Toolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused || !inSplit} />
      ) : visible ? (
        <ToolbarBackdrop tabId={tabId} />
      ) : (
        <View style={{ height: layout.toolbarHeight }} />
      )}
      {!autoLayout && bookmarksBar && <BookmarksBar placeholder={!visible} />}
      <Animated.View style={autoLayout ? motion.groupStyle : { flex: 1 }}>
        {autoLayout && bookmarksBar && <BookmarksBar placeholder={!visible} />}
        <View style={autoLayout ? { height: motion.pageHeight } : { flex: 1 }}>
          {visible && !fullscreen && <ShareBar tabId={tabId} />}
          <View style={{ flex: 1 }}>
            {(mounted || prewarmed) && <TabWebView tabId={tabId} visible={visible && !newTabShown && !isNewTab} warm={!!warm && !newTabShown && !isNewTab} />}
            {visible && isNewTab && !small && (inSplit ? <SplitEmptyState tabId={tabId} focused={focused} /> : emptyCard ? <EmptyCard windowId={windowId} tabId={tabId} /> : <NewTabPage key={tabId} tabId={tabId} toolbar={toolbar} />)}
            {visible && <InternalPage tabId={tabId} />}
            {visible && (
              <PageOverlays
                tabId={tabId}
                windowId={windowId}
                width={frame.width}
                geometry={geometry}
                toolbar={toolbar}
                fullscreen={fullscreen}
                newTabShown={newTabShown}
                statusStyle={autoLayout ? motion.bottomStyle : undefined}
                popovers={popovers}
                cliPill={!peekShown && (fullscreen || focused || !inSplit)}
              />
            )}
          </View>
        </View>
      </Animated.View>
      {hideBar && <AutoHideBackdrop tabId={tabId} mode={mode} motion={motion} />}
      {hideBar && !windowToolbar && <AutoHideToolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused || !inSplit} mode={mode} motion={motion} />}
    </View>
  );
});

const paneTab = (t: Tab | undefined) => ({ exists: !!t, url: t?.url ?? "", profileId: t?.profileId ?? "" });
