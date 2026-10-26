import { useLayoutEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { WindowDragRegion } from "../ui";
import { layout } from "../ui/theme";
import { useSettings, useWindowId, useWindowProfileId } from "../../state/browser/hooks";
import { useHasDownloads, useNoTiles } from "../../state/sidebar/hooks";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { DownloadsButton } from "../downloads/Downloads";
import { PROFILE_INDICATOR_X, ProfileIndicator } from "../profiles/ProfileIndicator";
import { usePagerPages } from "../../state/windows/profilePager";
import { PROFILE_DOTS_HEIGHT, ProfileDots, useProfileDotsShown } from "../profiles/ProfileDots";
import { SidebarAddressRow, SidebarHeaderTools } from "./AddressBar";
import { useSidebarHoverProps } from "./ClearDivider";
import { DragGhost } from "./DragGhost";
import { DragProvider } from "./DragProvider";
import type { Ghost } from "./dragModel";
import { SidebarDropArea } from "./SidebarDropArea";
import { FolderPanel } from "./FolderPanel";
import { dismissHover, dismissHoverIn } from "../../state/sidebar/hover";
import { PinFieldZone, PinSlotZone } from "./PinnedGrid";
import { ResizeHandle } from "./ResizeHandle";
import { SIDEBAR_FIELD, SIDEBAR_FOOTER_DOWNLOADS, SIDEBAR_HEADER_WITH_FIELD } from "./geometry";
import { closeFolderPanel } from "../../state/sidebar/tileFolderUi";
import { GLOW_ROOM, ROW_PITCH, type SidebarGeometry } from "./pageLayout";
import { SidebarPage } from "./SidebarPage";
import { SidebarRowLookContext, useSidebarRowLookSource } from "./rowLook";
import { useProfileOrder } from "../../state/profiles/hooks";
import { BriefArchiveButton } from "./BriefArchiveButton";
import { useRevealTabs } from "./useRevealTabs";

export function Sidebar({ width }: { width: number }) {
  const windowId = useWindowId();
  const current = useWindowProfileId();
  const { pages, paging } = usePagerPages(windowId);
  const [available, setAvailable] = useState(0);
  const newTabAtTop = useSettings((s) => s.newTabButtonPosition === "top");
  const dockAbove = newTabAtTop || available <= 0 ? Infinity : available - ROW_PITCH - 12;
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const geometry = useRef<SidebarGeometry>({ viewport: 0, regions: { pinnedGroups: 0, list: 0 }, newTabAtTop: false, room: 0, pad: 0, tilesFixed: true });
  const addressBar = useAddressBarInSidebar();
  const header = addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader;
  const hasDownloads = useHasDownloads(windowId);
  const dots = useProfileDotsShown();
  const footerDownloads = addressBar && hasDownloads;
  const profileCount = useProfileOrder((o) => o.length);
  const raisedDots = dots && profileCount * 12 > width - 100;
  const footer = PROFILE_DOTS_HEIGHT * (raisedDots ? 2 : 1);
  const nothingPinned = useNoTiles(windowId, current);
  const rowLook = useSidebarRowLookSource();

  const sidebarHover = useSidebarHoverProps(windowId);
  useRevealTabs(windowId, scroll, scrollY, geometry);
  useLayoutEffect(() => dismissHoverIn(windowId), [windowId, current, paging]);

  return (
    <DragProvider>
      {(ghost: Ghost | null, controller) => (
        <SidebarDropArea
          ref={(v) => {
            controller.root = v;
          }}
          style={{ width, height: "100%" }}
        >
          <View
            {...sidebarHover}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: header - GLOW_ROOM,
              bottom: footer,
              overflow: paging ? "hidden" : "visible",
            }}
            onLayout={(e) => setAvailable(e.nativeEvent.layout.height)}
          >
            <SidebarRowLookContext.Provider value={rowLook}>
              {pages.map((page) => (
                <SidebarPage
                  key={page.id}
                  profileId={page.id}
                  slot={page.slot}
                  width={width}
                  current={page.id === current}
                  resting={!!page.resting}
                  dockAbove={dockAbove}
                  height={Math.max(0, available - (addressBar ? GLOW_ROOM : 0))}
                  rows={page.id === current ? undefined : Math.ceil(available / ROW_PITCH) + 1}
                  geometry={page.id === current ? geometry : undefined}
                  onScrollView={(v) => {
                    scroll.current = v;
                    controller.scroll = v;
                  }}
                  onScrollY={(y) => {
                    scrollY.current = y;
                    controller.scrollY = y;
                    dismissHover();
                    closeFolderPanel();
                  }}
                />
              ))}
            </SidebarRowLookContext.Provider>
          </View>

          {footer ? (
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: footer }}>
              {dots ? <View style={{ position: "absolute", left: raisedDots ? 0 : 50, right: raisedDots ? 0 : 50, bottom: raisedDots ? PROFILE_DOTS_HEIGHT : 0 }}><ProfileDots windowId={windowId} /></View> : null}
              <BriefArchiveButton windowId={windowId} />
              {footerDownloads ? (
                <View style={{ position: "absolute", right: layout.sidebarInset, bottom: SIDEBAR_FOOTER_DOWNLOADS.bottom }}>
                  <DownloadsButton windowId={windowId} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ height: header }}>
            <WindowDragRegion style={StyleSheet.absoluteFill} />
            {addressBar ? (
              <>
                <SidebarHeaderTools width={width} />
                <SidebarAddressRow width={width} />
              </>
            ) : (
              <View pointerEvents="box-none" style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", paddingLeft: PROFILE_INDICATOR_X, paddingRight: 7, paddingTop: 27 - 17 }}>
                <ProfileIndicator room={width - PROFILE_INDICATOR_X - 7 - (hasDownloads ? 34 + 2 : 0)} />
                <View pointerEvents="none" style={{ flex: 1 }} />
                {hasDownloads ? <DownloadsButton windowId={windowId} /> : null}
              </View>
            )}
          </View>

          <ResizeHandle windowId={windowId} />
          {ghost && !ghost.landing && nothingPinned ? (
            addressBar ? (
              <PinFieldZone top={SIDEBAR_FIELD.top} height={SIDEBAR_FIELD.height} />
            ) : (
              <PinSlotZone />
            )
          ) : null}
          <FolderPanel windowId={windowId} />
          {ghost ? <DragGhost ghost={ghost} /> : null}
        </SidebarDropArea>
      )}
    </DragProvider>
  );
}
