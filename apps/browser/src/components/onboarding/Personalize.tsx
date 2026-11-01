import { StyleSheet, View } from "react-native";
import { useTabLayout } from "../../state/browser/hooks";
import { toggleTabLayout } from "../../state/splits/actions";
import { MiniWindow } from "../settings/MiniWindow";
import { OptionCard } from "./OptionCard";
import { useOnboardingColors } from "./Parts";
import { radius, space } from "../ui/tokens";

export const PERSONALIZE_COPY = {
  title: "Make it yours",
  subtitle: "Pick the theme color and layout that feel right for you.",
  layouts: "Choose how you would like to view your tabs:",
} as const;

export function TabLayoutPicker({ windowId }: { windowId: string }) {
  const layout = useTabLayout(windowId);
  const pick = (next: "sidebar" | "top") => {
    if (next !== layout) toggleTabLayout(windowId);
  };
  return (
    <View style={{ flexDirection: "row", gap: space.ml }} accessibilityRole="radiogroup" accessibilityLabel="Tab layout">
      <LayoutButton kind="sidebar" title="Sidebar" subtitle="Tabs down the side" selected={layout === "sidebar"} onPress={() => pick("sidebar")} />
      <LayoutButton kind="top" title="Classic" subtitle="Tabs along the top" selected={layout === "top"} onPress={() => pick("top")} />
    </View>
  );
}

const LAYOUT_PREVIEW_HEIGHT = 64;

function LayoutButton({ kind, title, subtitle, selected, onPress }: { kind: "sidebar" | "top"; title: string; subtitle: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const preview = (
    <View style={{ height: LAYOUT_PREVIEW_HEIGHT, borderRadius: radius.tile, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.previewBorder }}>
      <MiniWindow
        layout={kind === "sidebar" ? "side" : "top"}
        bars={[1, 0.8, 0.9]}
        size="m"
        look={{ window: colors.preview, bar: colors.progressTrack, page: colors.card, edge: colors.previewBorder }}
      />
    </View>
  );
  return <OptionCard control="radio" title={title} subtitle={subtitle} selected={selected} onPress={onPress} preview={preview} />;
}
