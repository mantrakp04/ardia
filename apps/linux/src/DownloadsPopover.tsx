import { useEffect, useRef } from "react";
import type { View } from "react-native";
import { DownloadsPopover as BrowserDownloadsPopover } from "../../browser/src/components/downloads/Downloads";
import { useWindowId } from "../../browser/src/state/browser/hooks";
import { setDownloadsOpen } from "../../browser/src/state/windows/actions";
import { useWindowUiOf } from "../../browser/src/state/windows/hooks";
import { startDownloadsDismissal } from "./downloadsDismissal";
import { PageOverlayRegion } from "./PageOverlayRegion";
import { watchPageFocus } from "./pageFocus";

export * from "../../browser/src/components/downloads/Downloads";

const BACKDROP = ":scope > * > :first-child";

export function DownloadsPopover() {
  const windowId = useWindowId();
  const open = useWindowUiOf(windowId, (ui) => !!ui?.downloadsOpen);
  const region = useRef<(View & HTMLElement) | null>(null);
  useEffect(() => {
    if (!open) return;
    return startDownloadsDismissal({
      target: window,
      inside: (node) => {
        const root = region.current;
        if (!root || !(node instanceof Node) || !root.contains(node)) return false;
        const backdrop = root.querySelector(BACKDROP);
        return !backdrop || !backdrop.contains(node);
      },
      close: () => setDownloadsOpen(windowId, false),
      watchPageFocus,
      activeElement: () => document.activeElement,
    });
  }, [open, windowId]);
  return (
    <PageOverlayRegion ref={region} testID="ardia-downloads-popover" dataSet={{ open: open ? "true" : "false" }}>
      <BrowserDownloadsPopover />
    </PageOverlayRegion>
  );
}
