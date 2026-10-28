import { memo } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { useTab } from "../../state/browser/hooks";
import { Button, PANEL, Popover, Symbol, Text, useHover } from "../ui";
import { useSiteTokens } from "./tokens";
import { popoverOf, setPopover, usePages } from "../../state/tabs/pageState";
import { type ToolbarPalette } from "../ui/toolbarColors";

export const ZoomIndicator = memo(function ZoomIndicator({ tabId, zoom, palette, box, radius, onFocus }: { tabId: string; zoom: number; palette: ToolbarPalette; box: number; radius: number; onFocus: () => void }) {
  const open = usePages((p) => p.popover[tabId] === "zoom");
  if (Math.abs(zoom - 1) < 0.001) return null;
  return (
    <Button variant="icon" toolbar
      palette={palette}
      icon={zoom > 1 ? "plus.magnifyingglass" : "minus.magnifyingglass"}
      size={13}
      box={box}
      radius={radius}
      onPress={() => {
        onFocus();
        setPopover(tabId, popoverOf(tabId) === "zoom" ? null : "zoom");
      }}
      active={open}
      tooltip={`Zoom: ${Math.round(zoom * 100)}%`}
    />
  );
});

export const ZOOM_POPOVER_WIDTH = 236;

export function ZoomPopover({ tabId, right, left, top }: { tabId: string; right?: number; left?: number; top: number }) {
  const zoom = useTab(tabId)?.zoom ?? 1;
  return (
    <Popover width={ZOOM_POPOVER_WIDTH} top={top} right={right} left={left} onDismiss={() => setPopover(tabId, null)}>
      <View style={{ flexDirection: "row", alignItems: "center", height: ZOOM_BAR, paddingLeft: PANEL.inset, paddingRight: (ZOOM_BAR - 28) / 2, gap: 8 }}>
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: percent ? 2 : 4 }}>
      <StepButton icon="minus" tooltip="Zoom Out (⌘-)" onPress={() => void webviews.get(tabId)?.zoomStep(-1)} />
      {percent ? (
        <Pressable onPress={() => void webviews.get(tabId)?.zoomStep(0)} tooltip="Reset to 100%">
          <Text size="small" tone={zoom === 1 ? "textSecondary" : "textPrimary"} style={{ width: 44, textAlign: "center", fontVariant: ["tabular-nums"] }}>
            {Math.round(zoom * 100)}%
          </Text>
        </Pressable>
      ) : null}
      <StepButton icon="plus" tooltip="Zoom In (⌘+)" onPress={() => void webviews.get(tabId)?.zoomStep(1)} />
    </View>
  );
}

function StepButton({ icon, tooltip, onPress }: { icon: string; tooltip: string; onPress: () => void }) {
  const theme = useTheme();
  const site = useSiteTokens();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View style={{ width: 24, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : site.stepper }}>
            <Symbol name={icon} size={10} weight="semibold" color={theme.icon} style={{ width: 14, height: 14 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
