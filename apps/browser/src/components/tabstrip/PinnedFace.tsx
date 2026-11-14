import { StyleSheet, View } from "react-native";
import { useSettings, useTab } from "../../state/browser/hooks";
import { useTileTheme } from "../../state/favicons/tileTheme";
import { TabBadges } from "../media/TabBadges";
import { TabIcon } from "../sidebar/TabIcon";
import { TileUnread } from "../unread/UnreadBadge";
import { DockSelection } from "../ui";
import { GlassFill, useGlass } from "../ui/Glass";
import { useTheme } from "../ui/theme";
import { ITEM_HEIGHT, PINNED_CELL, PINNED_FACE_INSET, pinnedFaceRadius, PINNED_RING_STROKE } from "./tokens";

export function PinnedFace({ tabId, active, hovered, pressed, frame = "cell" }: { tabId: string; active: boolean; hovered: boolean; pressed: boolean; frame?: "cell" | "face" }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const tileTheme = useTileTheme(tab?.url ?? "", tab?.favicon, tab?.customIcon, tab?.profileId ?? "");
  const glass = useGlass();
  const badges = useSettings((st) => st.showTopAppBadges);
  if (!tab) return null;
  const glassRing = active && glass;
  const compact = frame === "face";
  const face = compact
    ? StyleSheet.absoluteFillObject
    : { position: "absolute", left: PINNED_FACE_INSET, right: PINNED_FACE_INSET, top: PINNED_FACE_INSET, bottom: PINNED_FACE_INSET } as const;
  return (
    <View style={{ width: PINNED_CELL - (compact ? PINNED_FACE_INSET * 2 : 0), height: ITEM_HEIGHT - 1 - (compact ? PINNED_FACE_INSET * 2 : 0), alignItems: "center", justifyContent: "center" }}>
      {glassRing ? (
        <View style={face}>
          <GlassFill radius={pinnedFaceRadius()} state={pressed ? "pressed" : "active"} />
          <DockSelection
            image={tileTheme?.image}
            emoji={tileTheme?.emoji}
            theme={tileTheme?.theme.kind}
            fill={tileTheme?.theme.kind === "template" ? tileTheme.theme.fill : undefined}
            stroke={tileTheme?.theme.kind === "template" ? tileTheme.theme.stroke : undefined}
            cornerRadius={pinnedFaceRadius()}
            strokeWidth={PINNED_RING_STROKE}
            dark={theme.dark}
            glass
            colorRing
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : glass && (hovered || pressed) ? (
        <View style={face}>
          <GlassFill radius={pinnedFaceRadius()} state={pressed ? "pressed" : "lit"} />
        </View>
      ) : (active || hovered || pressed) && (
        <View
          style={{
            ...face,
            borderRadius: pinnedFaceRadius(),
            backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : theme.tabHover,
          }}
        />
      )}
      <View pointerEvents="none">
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <TabBadges tabId={tab.id} />
      </View>
      {badges ? <TileUnread tabId={tab.id} /> : null}
    </View>
  );
}
