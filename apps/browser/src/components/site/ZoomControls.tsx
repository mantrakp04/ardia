import { memo, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { webviews } from "../../state/tabs/webviewHandles";
import { useTab } from "../../state/browser/hooks";
import { Box, Button, PANEL, Popover, space, Text, usePopoverPresence } from "../ui";
import { usePages } from "../../state/tabs/pageState";
import { dismissZoomPopover, hoverZoomPopover, toggleZoomPopover, useIsZoomBubble } from "../../state/site/zoomBubble";
import { markHoverProps } from "../../lib/hoverMarks";
import { type ToolbarPalette } from "../ui/toolbarColors";

export const ZoomIndicator = memo(function ZoomIndicator({ tabId, zoom, palette, onFocus }: { tabId: string; zoom: number; palette: ToolbarPalette; onFocus: () => void }) {
  const open = usePages((p) => p.popover[tabId] === "zoom");
  const actualSize = Math.abs(zoom - 1) < 0.001;
  if (actualSize && !open) return null;
  return (
    <Button variant="icon" toolbar
      look="field"
      palette={palette}
      icon={actualSize ? "magnifyingglass" : zoom > 1 ? "plus.magnifyingglass" : "minus.magnifyingglass"}
      onPress={() => {
        onFocus();
        toggleZoomPopover(tabId);
      }}
      active={open}
      tooltip={`Zoom: ${Math.round(zoom * 100)}%`}
    />
  );
});

export const ZOOM_POPOVER_WIDTH = 236;

type ZoomPopoverPlace = { tabId: string; right?: number; left?: number; top: number };

export function ZoomPopover({ open, ...place }: ZoomPopoverPlace & { open: boolean }) {
  const presence = usePopoverPresence(open);
  return presence.shown ? <ZoomPanel {...place} closing={presence.closing} onClosed={presence.onClosed} /> : null;
}

function ZoomPanel({ tabId, right, left, top, closing, onClosed }: ZoomPopoverPlace & { closing: boolean; onClosed: () => void }) {
  const zoom = useTab(tabId)?.zoom ?? 1;
  const bubble = useIsZoomBubble(tabId);
  const [hoverProps] = useState(() => markHoverProps({ onMouseEnter: () => hoverZoomPopover(tabId, true), onMouseLeave: () => hoverZoomPopover(tabId, false) }));
  useEffect(() => () => hoverZoomPopover(tabId, false), [tabId]);
  return (
    <Popover width={ZOOM_POPOVER_WIDTH} top={top} right={right} left={left} modal={!bubble} onDismiss={() => dismissZoomPopover(tabId)} closing={closing} onClosed={onClosed}>
      <View {...hoverProps} style={{ flexDirection: "row", alignItems: "center", height: ZOOM_BAR, paddingLeft: PANEL.inset, paddingRight: (ZOOM_BAR - 28) / 2, gap: space.m }}>
        <Text style={TABULAR_FILL}>{`Zoom: ${Math.round(zoom * 100)}%`}</Text>
        <ZoomStepper tabId={tabId} zoom={zoom} percent={false} />
        <Button variant="pill" title="Reset" onPress={() => void webviews.get(tabId)?.zoomStep(0)} />
      </View>
    </Popover>
  );
}

const ZOOM_BAR = 48;
const TABULAR_FILL = { flex: 1, fontVariant: ["tabular-nums" as const] };

export function ZoomStepper({ tabId, zoom, percent = true }: { tabId: string; zoom: number; percent?: boolean }) {
  return (
    <Box row gap={percent ? "xxs" : "xs"} style={CENTER_ROW}>
      <Button variant="stepper" icon="minus" tooltip="Zoom Out (⌘-)" onPress={() => void webviews.get(tabId)?.zoomStep(-1)} />
      {percent ? (
        <Pressable onPress={() => void webviews.get(tabId)?.zoomStep(0)} tooltip="Reset to 100%">
          <Text size="small" tone={zoom === 1 ? "textSecondary" : "textPrimary"} style={{ width: 44, textAlign: "center", fontVariant: ["tabular-nums"] }}>
            {Math.round(zoom * 100)}%
          </Text>
        </Pressable>
      ) : null}
      <Button variant="stepper" icon="plus" tooltip="Zoom In (⌘+)" onPress={() => void webviews.get(tabId)?.zoomStep(1)} />
    </Box>
  );
}

const CENTER_ROW = { alignItems: "center" } as const;

