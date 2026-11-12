import { memo } from "react";
import { View } from "react-native";
import { useTab } from "../../state/browser/hooks";
import { usePeekOpenedFrom } from "../../state/peek/hooks";
import { Favicon } from "../favicon/Favicon";
import { useTheme } from "../ui/theme";
import { PEEK_MARK } from "./tokens";

export const PeekMark = memo(function PeekMark({ tabId, size }: { tabId: string; size: number }) {
  const peekId = usePeekOpenedFrom(tabId);
  return peekId ? <PeekedFavicon peekId={peekId} size={size} /> : null;
});

function PeekedFavicon({ peekId, size }: { peekId: string; size: number }) {
  const theme = useTheme();
  const url = useTab(peekId, (t) => t?.url ?? "");
  const favicon = useTab(peekId, (t) => t?.favicon ?? null);
  const profileId = useTab(peekId, (t) => t?.profileId);
  const icon = Math.round(size * PEEK_MARK.scale);
  const box = icon + 2 * PEEK_MARK.plate;
  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Has a Peek open"
      style={{
        position: "absolute",
        right: -box / 2,
        bottom: -box / 3,
        width: box,
        height: box,
        borderRadius: PEEK_MARK.radius,
        padding: PEEK_MARK.plate,
        backgroundColor: theme.panel,
      }}
    >
      <Favicon url={url} favicon={favicon} size={icon} profileId={profileId} />
    </View>
  );
}
