import { Symbol } from "../ui";
import { memo } from "react";
import { View } from "react-native";
import { hex, useTheme } from "../ui/theme";
import { ink } from "../ui/tokens";
import { usePage } from "../../state/tabs/pageState";
import { useSidebarTokens } from "../sidebar/tokens";
import { useMedia } from "../../state/media/media";
import { CAPTURE_DOT_RIM } from "./tokens";

export const TabBadges = memo(function TabBadges({ tabId, size = 16, pip = true }: { tabId: string; size?: number; pip?: boolean }) {
  return (
    <>
      {pip && <PipBadge tabId={tabId} size={size} />}
      <CaptureBadge tabId={tabId} size={size} />
    </>
  );
});

function PipBadge({ tabId, size }: { tabId: string; size: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const open = useMedia((m) => !!m.pipOpen[tabId]);
  if (!open) return null;
  const d = Math.round(size * 0.72);
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", right: -d / 3, top: -d / 3, width: d, height: d, borderRadius: d / 2, backgroundColor: tokens.badge, alignItems: "center", justifyContent: "center" }}
    >
      <Symbol name="pip.fill" size={d * 0.55} weight="bold" color={hex(theme.onPrimary)} style={{ width: d, height: d }} />
    </View>
  );
}

function CaptureBadge({ tabId, size }: { tabId: string; size: number }) {
  const theme = useTheme();
  const capture = usePage(tabId, (p) => p.mediaAccess);
  if (!capture) return null;
  if (capture.screen) {
    const d = Math.round(size * 0.72);
    return (
      <View
        pointerEvents="none"
        style={{ position: "absolute", right: -d / 3, bottom: -d / 3, width: d, height: d, borderRadius: d / 2, backgroundColor: theme.destructive, alignItems: "center", justifyContent: "center" }}
      >
        <Symbol name="rectangle.inset.filled" size={d * 0.5} weight="bold" color={ink.white} style={{ width: d, height: d }} />
      </View>
    );
  }
  const d = Math.max(6, Math.round(size * 0.44));
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", right: -d / 4, bottom: -d / 4, width: d, height: d, borderRadius: d / 2, backgroundColor: theme.destructive, borderWidth: 1, borderColor: CAPTURE_DOT_RIM }}
    />
  );
}
