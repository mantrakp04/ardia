import { Dot, Symbol } from "../ui";
import { memo } from "react";
import { View } from "react-native";
import { useTheme } from "../ui/theme";
import { ink } from "../ui/tokens";
import { usePage } from "../../state/tabs/pageState";
import { CAPTURE_DOT_RIM } from "./tokens";
import { PeekMark } from "../peek/PeekMark";

export const TabBadges = memo(function TabBadges({ tabId, size = 16 }: { tabId: string; size?: number }) {
  return (
    <>
      <CaptureBadge tabId={tabId} size={size} />
      <PeekMark tabId={tabId} size={size} />
    </>
  );
});

function CaptureBadge({ tabId, size }: { tabId: string; size: number }) {
  const theme = useTheme();
  const capture = usePage(tabId, (p) => p.mediaAccess);
  if (!capture) return null;
  if (capture.screen) {
    const d = Math.round(size * 0.72);
    return (
      <View pointerEvents="none" style={{ position: "absolute", right: -d / 3, bottom: -d / 3 }}>
        <Dot size={d} color={theme.destructive}>
          <Symbol name="rectangle.inset.filled" size={d * 0.5} weight="bold" color={ink.white} style={{ width: d, height: d }} />
        </Dot>
      </View>
    );
  }
  const d = Math.max(6, Math.round(size * 0.44));
  return (
    <View pointerEvents="none" style={{ position: "absolute", right: -d / 4, bottom: -d / 4 }}>
      <Dot size={d} color={theme.destructive} ring={CAPTURE_DOT_RIM} />
    </View>
  );
}
