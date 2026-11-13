import type { ComponentProps } from "react";
import { BesidePeekPopovers as BrowserBesidePeekPopovers, PageOverlays as BrowserPageOverlays } from "../../browser/src/components/window/PageOverlays";
import { NO_TOOLBAR } from "../../browser/src/components/window/geometry";
import { TabWebView } from "../../browser/src/components/window/TabWebView";
import { PageOverlayRegion } from "./PageOverlayRegion";

export * from "../../browser/src/components/window/PageOverlays";

export function PageOverlays(props: ComponentProps<typeof BrowserPageOverlays>) {
  return (
    <PageOverlayRegion testID="ardia-page-overlays">
      <BrowserPageOverlays {...props} />
    </PageOverlayRegion>
  );
}

export function BesidePeekPopovers(props: ComponentProps<typeof BrowserBesidePeekPopovers>) {
  return (
    <PageOverlayRegion testID="ardia-beside-peek-popovers">
      <BrowserBesidePeekPopovers {...props} />
    </PageOverlayRegion>
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
