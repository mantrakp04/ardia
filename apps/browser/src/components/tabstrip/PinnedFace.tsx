import { StyleSheet, View } from "react-native";
import { useSettings, useTab } from "../../state/browser/hooks";
import { useTileTheme } from "../../state/favicons/tileTheme";
import { TabBadges } from "../media/TabBadges";
import { TabIcon } from "../sidebar/TabIcon";
import { DockSelection } from "../ui";
import { GlassFill, liquidGlass } from "../ui/Glass";
import { useTheme } from "../ui/theme";
import { ITEM_HEIGHT, PINNED_CELL, PINNED_FACE_INSET, PINNED_FACE_RADIUS, PINNED_RING_STROKE } from "./tokens";

export function PinnedFace({ tabId, active, hovered, pressed }: { tabId: string; active: boolean; hovered: boolean; pressed: boolean }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const tileTheme = useTileTheme(tab?.url ?? "", tab?.favicon, tab?.customIcon, tab?.profileId ?? "");
  const iconRing = useSettings((s) => s.pinnedTabIconRing);
  if (!tab) return null;
  const ring = active && liquidGlass && iconRing && tileTheme ? tileTheme : null;
  const glassRing = active && liquidGlass && !iconRing;
  const template = ring?.theme.kind === "template" ? ring.theme : null;
  const face = { position: "absolute", left: PINNED_FACE_INSET, right: PINNED_FACE_INSET, top: PINNED_FACE_INSET, bottom: PINNED_FACE_INSET } as const;
  return (
    <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
      {ring ? (
        <DockSelection
          image={ring.image}
          emoji={ring.emoji}
          theme={ring.theme.kind}
          fill={template?.fill}
          stroke={template?.stroke}
          cornerRadius={PINNED_FACE_RADIUS}
          strokeWidth={PINNED_RING_STROKE}
          dark={theme.dark}
          style={face}
        />
      ) : glassRing ? (
        <View style={face}>
          <GlassFill radius={PINNED_FACE_RADIUS} fill={theme.pinnedSelectedFill} raised={!pressed} />
          <DockSelection
            image={tileTheme?.image}
            emoji={tileTheme?.emoji}
            theme={tileTheme?.theme.kind}
            fill={tileTheme?.theme.kind === "template" ? tileTheme.theme.fill : undefined}
            stroke={tileTheme?.theme.kind === "template" ? tileTheme.theme.stroke : undefined}
            cornerRadius={PINNED_FACE_RADIUS}
            strokeWidth={PINNED_RING_STROKE}
            dark={theme.dark}
            glass
            colorRing
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : (active || hovered || pressed) && (
        <View
          style={{
            ...face,
            borderRadius: PINNED_FACE_RADIUS,
            backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : theme.tabHover,
          }}
        />
      )}
      <View pointerEvents="none">
        {template ? <View style={{ width: 16, height: 16 }} /> : <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />}
        <TabBadges tabId={tab.id} pip={false} />
      </View>
    </View>
  );
}
