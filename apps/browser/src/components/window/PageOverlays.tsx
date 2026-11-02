import { Animated, StyleSheet, type ViewStyle } from "react-native";
import { ENGINE_OFFER_WIDTH, EngineOfferPrompt } from "../site/EnginePrompt";
import { useTabValue } from "../../state/tabs/tabWatch";
import { CliControlPill } from "./CliControlPill";
import { FindBar } from "../find/FindBar";
import { POPOVER_MARGIN } from "../ui";
import { NO_TOOLBAR, type ToolbarGeometry } from "./geometry";
import { usePages } from "../../state/tabs/pageState";
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
import { TabWebView } from "./TabWebView";

const fitLeft = (urlLeft: number, paneWidth: number, promptWidth: number) => Math.max(POPOVER_MARGIN, Math.min(urlLeft, paneWidth - promptWidth - POPOVER_MARGIN));

export function PageOverlays({
  tabId,
  windowId,
  width,
  geometry,
  toolbar,
  fullscreen,
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
  fullscreen: boolean;
  newTabShown: boolean;
  statusStyle?: Animated.WithAnimatedValue<ViewStyle>;
  popovers?: boolean;
  cliPill?: boolean;
}) {
  const popover = usePages((s) => s.popover[tabId] ?? null);
  const zoom = useTabValue(tabId, (t) => t?.zoom ?? 1);
  const popoverSide = toolbar ? { right: POPOVER_MARGIN } : { left: POPOVER_MARGIN };
  return (
    <>
      <FindBar tabId={tabId} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, statusStyle]}>
        <StatusBubble tabId={tabId} maxWidth={Math.max(160, width / 2)} />
      </Animated.View>
      <SadTab tabId={tabId} />
      {cliPill && <CliControlPill style={statusStyle} />}
      {!newTabShown && <PermissionPrompt tabId={tabId} left={fitLeft(geometry.urlLeft, width, PERMISSION_PROMPT_WIDTH)} top={POPOVER_MARGIN} />}
      <PasswordPrompt tabId={tabId} right={POPOVER_MARGIN} top={POPOVER_MARGIN} />
      <AutofillPrompt tabId={tabId} right={POPOVER_MARGIN} top={POPOVER_MARGIN} />
      {!newTabShown && <ExternalAppPrompt tabId={tabId} left={fitLeft(geometry.urlLeft, width, EXTERNAL_APP_WIDTH)} top={POPOVER_MARGIN} />}
      {!newTabShown && <EngineOfferPrompt tabId={tabId} left={fitLeft(geometry.urlLeft, width, ENGINE_OFFER_WIDTH)} top={POPOVER_MARGIN} />}
      {popovers && <SiteControls tabId={tabId} open={popover === "siteControls"} {...popoverSide} top={POPOVER_MARGIN} />}
      {popovers && popover === "popups" && <BlockedPopupsPrompt tabId={tabId} {...popoverSide} top={POPOVER_MARGIN} />}
      {popovers && <ZoomPopover tabId={tabId} open={popover === "zoom"} {...popoverSide} top={POPOVER_MARGIN} />}
      <SharePicker tabId={tabId} paneWidth={width} />
      {!newTabShown && <DeviceChooser tabId={tabId} left={fitLeft(geometry.urlLeft, width, DEVICE_CHOOSER_WIDTH)} top={POPOVER_MARGIN} />}
      <CastPicker tabId={tabId} paneWidth={width} />
      <NavigationOverlays tabId={tabId} windowId={windowId} geometry={geometry} />
      <SelectionPopover tabId={tabId} zoom={zoom} />
    </>
  );
}

export function BesidePeekPopovers({ tabId, left, top, room }: { tabId: string; left: number; top: number; room: number }) {
  const popover = usePages((s) => s.popover[tabId] ?? null);
  const fit = (width: number) => ({ left: fitLeft(left, room, width), top });
  return (
    <>
      <SiteControls tabId={tabId} open={popover === "siteControls"} {...fit(SITE_PANEL.width)} />
      {popover === "popups" && <BlockedPopupsPrompt tabId={tabId} {...fit(BLOCKED_POPUPS_WIDTH)} />}
      <ZoomPopover tabId={tabId} open={popover === "zoom"} {...fit(ZOOM_POPOVER_WIDTH)} />
    </>
  );
}

export function PeekPage({ tabId, sourceId, windowId, width, fullscreen }: { tabId: string; sourceId: string; windowId: string; width: number; fullscreen: boolean }) {
  return (
    <>
      <TabWebView tabId={tabId} visible warm={false} peekOf={sourceId} />
      <PageOverlays tabId={tabId} windowId={windowId} width={width} geometry={NO_TOOLBAR} toolbar={false} fullscreen={fullscreen} newTabShown={false} cliPill />
    </>
  );
}
