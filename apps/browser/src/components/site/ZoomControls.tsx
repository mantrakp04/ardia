import { Symbol } from "@ardia/shell";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useTab } from "../../store/hooks";
import { PANEL, Popover, PromptButton, ToolbarButton } from "../layout/controls";
import { setPopover, usePages } from "../layout/pageState";
import { type ToolbarPalette } from "../layout/toolbarColors";
import { useHover } from "../primitives";

export const ZoomIndicator = memo(function ZoomIndicator({ tabId, zoom, palette, onFocus }: { tabId: string; zoom: number; palette: ToolbarPalette; onFocus: () => void }) {
  const open = usePages((p) => p.popover[tabId] === "zoom");
  if (Math.abs(zoom - 1) < 0.001) return null;
  return (
    <ToolbarButton
      palette={palette}
      icon={zoom > 1 ? "plus.magnifyingglass" : "minus.magnifyingglass"}
      size={13}
      box={24}
      radius={6}
      onPress={() => {
        onFocus();
        setPopover(tabId, usePages.getState().popover[tabId] === "zoom" ? null : "zoom");
      }}
      active={open}
      tooltip={`Zoom: ${Math.round(zoom * 100)}%`}
    />
  );
});

export const ZOOM_POPOVER_WIDTH = 236;

export function ZoomPopover({ tabId, right, left, top }: { tabId: string; right?: number; left?: number; top: number }) {
  const theme = useTheme();
  const zoom = useTab(tabId)?.zoom ?? 1;
  return (
    <Popover width={ZOOM_POPOVER_WIDTH} top={top} right={right} left={left} onDismiss={() => setPopover(tabId, null)}>
      <View style={{ flexDirection: "row", alignItems: "center", height: ZOOM_BAR, paddingLeft: PANEL.inset, paddingRight: (ZOOM_BAR - 28) / 2, gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, fontVariant: ["tabular-nums"], color: theme.textPrimary }}>{`Zoom: ${Math.round(zoom * 100)}%`}</Text>
        <ZoomStepper tabId={tabId} zoom={zoom} percent={false} />
        <PromptButton title="Reset" onPress={() => void webviews.get(tabId)?.zoomStep(0)} />
      </View>
    </Popover>
  );
}

const ZOOM_BAR = 48;

export function ZoomStepper({ tabId, zoom, percent = true }: { tabId: string; zoom: number; percent?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: percent ? 2 : 4 }}>
      <StepButton icon="minus" tooltip="Zoom Out (⌘-)" onPress={() => void webviews.get(tabId)?.zoomStep(-1)} />
      {percent ? (
        <Pressable onPress={() => void webviews.get(tabId)?.zoomStep(0)} tooltip="Reset to 100%">
          <Text style={{ width: 44, textAlign: "center", fontSize: 12, fontVariant: ["tabular-nums"], color: zoom === 1 ? theme.textSecondary : theme.textPrimary }}>
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
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View style={{ width: 24, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }}>
            <Symbol name={icon} size={10} weight="semibold" color={theme.icon} style={{ width: 14, height: 14 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
