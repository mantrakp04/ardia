import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { startChromeTabs } from "../../state/tabs/chromeTabs";
import { useIsSmallWindow, useSplitOf } from "../../state/windows/card";
import { usePeeks } from "../../state/peek/hooks";
import { useActiveTabId, useSettings, useWindowId } from "../../state/browser/hooks";
import { useBookmarksBarHeight } from "../bookmarks/barSize";
import { useBookmarksBarMode } from "../../state/bookmarks/hooks";
import { POPOVER_MARGIN } from "../ui";
import { NO_TOOLBAR, toolbarGeometry, type Rect, type ToolbarGeometry } from "./geometry";
import { startPermissionPrompts } from "../../state/site/permissions";
import { useFullscreenTab } from "../../state/tabs/pageState";
import { DropTargets, SplitDividers, SplitToast } from "../split/SplitChrome";
import { dockMoving, usePeekEdge, whenDockStill } from "../../state/windows/dockMotion";
import { FrozenPage } from "./FrozenPage";
import { setCardAnchor, setUrlAnchor, useAddressBarInSidebar, useTabLayout, watchToolbarExtensionsWidth } from "../../state/windows/layout";
import { startSelectionTools } from "../../state/site/selection";
import { startMedia } from "../../state/media/pip";
import { urlFieldRight } from "../toolbar/Toolbar";
import { WindowToolbar } from "../toolbar/WindowToolbar";
import { useToolbarRow } from "../toolbar/useToolbarRow";
import "../dev/devExpose";
import { PeekOverlay } from "../peek/PeekOverlay";
import { dismissPeek, startPeeks } from "../../state/peek/actions";
import { usePaneLayout } from "./usePaneLayout";
import { cardChrome } from "./paneChrome";
import { TabPane } from "./TabPane";
import { BesidePeekPopovers, PeekPage } from "./PageOverlays";
import { splitTabIdsOf } from "../../state/splits/splits";

export function ContentCard() {
  const windowId = useWindowId();
  const activeId = useActiveTabId();
  const split = useSplitOf(activeId);
  const fullscreenTab = useFullscreenTab(windowId);
  const tabLayout = useTabLayout();
  const addressInSidebar = useAddressBarInSidebar();
  const small = useIsSmallWindow(windowId);
  const hideWhileScrolling = useSettings((st) => st.hideToolbarWhileScrolling);
  const showSidebarButton = useSettings((st) => st.showSidebarButton !== false);
  const barMode = useBookmarksBarMode(windowId);
  const toolbarRow = useToolbarRow();
  const barHeight = useBookmarksBarHeight();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const container = useRef<View>(null);
  useEffect(startPermissionPrompts, []);
  useEffect(startChromeTabs, []);
  useEffect(startMedia, []);
  useEffect(startSelectionTools, []);
  useEffect(startPeeks, []);
  const peekId = usePeeks((p) => p[windowId]?.tabId);
  const peekFullscreen = !!peekId && fullscreenTab === peekId;
  useEffect(() => {
    if (fullscreenTab && peekId && !peekFullscreen) dismissPeek(windowId);
  }, [fullscreenTab, peekId, peekFullscreen, windowId]);

  const { mountedIds, panes, dividers, warmPanes, shown, lingerId, lingerRect } = usePaneLayout(windowId, activeId, split, fullscreenTab, size);

  const chrome = useMemo(
    () => cardChrome({ addressInSidebar, small, split: !!split, fullscreen: !!fullscreenTab, hideWhileScrolling }),
    [addressInSidebar, small, !!split, !!fullscreenTab, hideWhileScrolling],
  );
  const geometryFor = (rect: Rect | undefined): ToolbarGeometry => {
    if (chrome.kind === "none") return NO_TOOLBAR;
    const leading = !!rect && rect.x === 0 && rect.y === 0;
    return toolbarGeometry({ sidebarButton: leading && tabLayout === "sidebar" && showSidebarButton });
  };

  const focusedRect = activeId ? panes[activeId] : undefined;
  useEffect(() => {
    if (!origin || !focusedRect || chrome.kind === "none") return;
    const g = geometryFor(focusedRect);
    const place = (extensionsWidth = 0) =>
      setUrlAnchor(windowId, {
        left: origin.x + focusedRect.x + g.urlLeft,
        top: origin.y + focusedRect.y,
        width: focusedRect.width - g.urlLeft - urlFieldRight(!!split, extensionsWidth, toolbarRow),
      });
    return watchToolbarExtensionsWidth(windowId, place);
  }, [origin, focusedRect?.x, focusedRect?.y, focusedRect?.width, tabLayout, chrome.kind, !!split, showSidebarButton, toolbarRow]);

  useEffect(() => {
    if (origin && size.width > 0) setCardAnchor(windowId, { left: origin.x, top: origin.y, width: size.width, height: size.height });
  }, [origin, size.width, size.height, windowId]);

  const settled = useRef<{ width: number; height: number } | null>(null);
  const measure = (width: number, height: number) => {
    setSize({ width, height });
    container.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  };
  useEffect(
    () =>
      whenDockStill(windowId, () => {
        if (!settled.current) return;
        const { width, height } = settled.current;
        settled.current = null;
        measure(width, height);
      }),
    [windowId],
  );

  const peekEdge = usePeekEdge(windowId);
  const activeRect = activeId ? panes[activeId] : undefined;
  const popoversOverCard = peekEdge !== undefined && addressInSidebar && !small && !fullscreenTab && origin && activeRect ? activeId : undefined;

  return (
    <View
      ref={container}
      style={{ flex: 1 }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (size.width > 0 && dockMoving(windowId) && !split) settled.current = { width, height };
        else measure(width, height);
      }}
    >
      {size.width > 0 &&
        shown.map((key) => {
          const tabId = key.slice(0, key.indexOf("|"));
          const rect = panes[tabId] ?? (tabId === lingerId ? lingerRect : undefined);
          return (
            <TabPane
              key={key}
              tabId={tabId}
              windowId={windowId}
              rect={rect}
              fills={!!rect && rect.x === 0 && rect.y === 0 && rect.width === size.width && rect.height === size.height}
              fullWidth={size.width}
              fullHeight={size.height}
              focused={tabId === activeId}
              inActiveSplit={!!splitTabIdsOf(split)?.includes(tabId)}
              fullscreen={tabId === fullscreenTab}
              covered={!!fullscreenTab && tabId !== fullscreenTab}
              geometry={geometryFor(rect)}
              chrome={chrome}
              small={small}
              mounted={mountedIds.has(tabId)}
              warm={warmPanes[tabId]}
              barMode={barMode}
              popovers={tabId !== popoversOverCard}
              peekShown={!!peekId}
              lingering={tabId === lingerId}
              seeThrough={!!lingerId && tabId === activeId}
            />
          );
        })}
      {size.width > 0 && chrome.kind === "window" && activeId && panes[activeId] && (
        <WindowToolbar windowId={windowId} tabId={activeId} geometry={geometryFor(panes[activeId])} autoHide={chrome.autoHide} />
      )}
      {size.width > 0 && !split && !fullscreenTab && (
        <FrozenPage windowId={windowId} tabId={activeId} top={(chrome.kind !== "none" && !chrome.autoHide ? toolbarRow.height : 0) + (barMode === "always" && !small && !hideWhileScrolling ? barHeight : 0)} />
      )}
      {split && !fullscreenTab && <SplitDividers split={split} dividers={dividers} width={size.width} height={size.height} />}
      {size.width > 0 && popoversOverCard && origin && activeRect && peekEdge !== undefined && (
        <BesidePeekPopovers
          tabId={popoversOverCard}
          left={Math.max(activeRect.x, peekEdge - origin.x) + POPOVER_MARGIN}
          top={activeRect.y + POPOVER_MARGIN}
          room={size.width}
        />
      )}
      {!fullscreenTab && <DropTargets panes={panes} origin={origin} />}
      {(!fullscreenTab || peekFullscreen) && !small && (
        <PeekOverlay
          windowId={windowId}
          width={size.width}
          height={size.height}
          origin={origin}
          fullscreen={peekFullscreen}
          page={(tabId, sourceId, width) => <PeekPage tabId={tabId} sourceId={sourceId} windowId={windowId} width={width} fullscreen={peekFullscreen} />}
        />
      )}
      <SplitToast windowId={windowId} />
    </View>
  );
}
