import { useEffect } from "react";
import { Animated, StyleSheet, type ViewStyle } from "react-native";
import { ENGINE_OFFER_WIDTH, EngineOfferPrompt } from "../site/EnginePrompt";
import { useTabValue } from "../../state/tabs/tabWatch";
import { CliControlPill } from "./CliControlPill";
import { NewTabNotice } from "./NewTabNotice";
import { FindBar } from "../find/FindBar";
import { POPOVER_MARGIN } from "../ui";
import { NO_TOOLBAR, type ToolbarGeometry } from "./geometry";
import { usePages } from "../../state/tabs/pageState";
import { startPopoverEscape } from "../../state/tabs/popoverDismiss";
import { SadTab, StatusBubble } from "./PaneOverlays";
import { AutofillPrompt, BLOCKED_POPUPS_WIDTH, BlockedPopupsPrompt, EXTERNAL_APP_WIDTH, ExternalAppPrompt, PasswordPrompt, PERMISSION_PROMPT_WIDTH, PermissionPrompt } from "../site/Prompts";
import { SiteControls } from "../site/SiteControls";
import { SITE_PANEL } from "../site/SiteControlsParts";
import { ZOOM_POPOVER_WIDTH, ZoomPopover } from "../site/ZoomControls";
import { SelectionPopover } from "../site/SelectionPopover";
import { SharePicker } from "../media/SharePicker";
import { CastPicker } from "../media/CastPicker";
import { DEVICE_CHOOSER_WIDTH, DeviceChooser } from "../site/DeviceChooser";
import { NavigationOverlays } from "./SwipeOverlay";
import { HISTORY_MENU_WIDTH, HistoryPopover } from "./HistoryPopover";
import { TabWebView } from "./TabWebView";
import { fitLeft, pageSurfaceLeft, type PageAnchor, type PageSurface } from "./pageAnchors";
import { useSidebarSide } from "../../state/browser/hooks";

export function PageOverlays({
  tabId,
  windowId,
  width,
  geometry,
  toolbar,
  newTabShown,
  statusStyle,
  popovers = true,
  cliPill = false,
}: {
  tabId: string;
  windowId: string;
  width: number;
  geometry: ToolbarGeometry;
  toolbar: boolean;
  newTabShown: boolean;
  statusStyle?: Animated.WithAnimatedValue<ViewStyle>;
  popovers?: boolean;
  cliPill?: boolean;
}) {
  const popover = usePages((s) => s.popover[tabId] ?? null);
  const zoom = useTabValue(tabId, (t) => t?.zoom ?? 1);
  const sidebarRight = useSidebarSide(windowId) === "right";
  const anchor: PageAnchor = { toolbar: toolbar ? geometry : null, sidebarRight };
  const at = (surface: PageSurface, surfaceWidth: number) => ({ left: pageSurfaceLeft(anchor, surface, width, surfaceWidth), top: POPOVER_MARGIN });
  useEffect(startPopoverEscape, []);
  return (
    <>
      <FindBar tabId={tabId} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, statusStyle]}>
        <StatusBubble tabId={tabId} maxWidth={Math.max(160, width / 2)} />
      </Animated.View>
      <SadTab tabId={tabId} />
      {cliPill && <CliControlPill style={statusStyle} />}
      {!newTabShown && <PermissionPrompt tabId={tabId} {...at("prompt", PERMISSION_PROMPT_WIDTH)} />}
      <PasswordPrompt tabId={tabId} right={POPOVER_MARGIN} top={POPOVER_MARGIN} />
      <AutofillPrompt tabId={tabId} right={POPOVER_MARGIN} top={POPOVER_MARGIN} />
      <NewTabNotice windowId={windowId} tabId={tabId} right={POPOVER_MARGIN} top={POPOVER_MARGIN} />
      {!newTabShown && <ExternalAppPrompt tabId={tabId} {...at("prompt", EXTERNAL_APP_WIDTH)} />}
      {!newTabShown && <EngineOfferPrompt tabId={tabId} {...at("prompt", ENGINE_OFFER_WIDTH)} />}
      {popovers && <SiteControls tabId={tabId} open={popover === "siteControls"} {...at("siteButton", SITE_PANEL.width)} />}
      {popovers && popover === "popups" && <BlockedPopupsPrompt tabId={tabId} {...at("siteButton", BLOCKED_POPUPS_WIDTH)} />}
      {popovers && <ZoomPopover tabId={tabId} open={popover === "zoom"} {...at("siteButton", ZOOM_POPOVER_WIDTH)} />}
      <SharePicker tabId={tabId} paneWidth={width} />
      {!newTabShown && <DeviceChooser tabId={tabId} {...at("prompt", DEVICE_CHOOSER_WIDTH)} />}
      <CastPicker tabId={tabId} paneWidth={width} />
      <NavigationOverlays tabId={tabId} windowId={windowId} anchor={anchor} paneWidth={width} historyMenu={popovers} />
      <SelectionPopover tabId={tabId} zoom={zoom} />
    </>
  );
}

export function BesidePeekPopovers({ tabId, windowId, left, top, room }: { tabId: string; windowId: string; left: number; top: number; room: number }) {
  const popover = usePages((s) => s.popover[tabId] ?? null);
  const fit = (width: number) => ({ left: fitLeft(left, room, width), top });
  return (
    <>
      <SiteControls tabId={tabId} open={popover === "siteControls"} {...fit(SITE_PANEL.width)} />
      {popover === "popups" && <BlockedPopupsPrompt tabId={tabId} {...fit(BLOCKED_POPUPS_WIDTH)} />}
      <ZoomPopover tabId={tabId} open={popover === "zoom"} {...fit(ZOOM_POPOVER_WIDTH)} />
      <HistoryPopover tabId={tabId} windowId={windowId} top={top} left={() => fitLeft(left, room, HISTORY_MENU_WIDTH)} />
    </>
  );
}

export function PeekPage({ tabId, sourceId, windowId, width }: { tabId: string; sourceId: string; windowId: string; width: number }) {
  return (
    <>
      <TabWebView tabId={tabId} visible warm={false} peekOf={sourceId} />
      <PageOverlays tabId={tabId} windowId={windowId} width={width} geometry={NO_TOOLBAR} toolbar={false} newTabShown={false} cliPill />
    </>
  );
}
