import { memo } from "react";
import { View } from "react-native";
import { Symbol, withAlpha } from "../ui";
import { useTheme } from "../ui/theme";
import { useSharedFolderMark } from "../../state/sharedFolders/hooks";
import { useSidebarTokens } from "./tokens";
import { useSidebarScale } from "./scale";

const GLYPH = { shared: "person.2.fill", waiting: "icloud.and.arrow.down", error: "exclamationmark.icloud" } as const;
const MARK_GLYPH = 10;
const SPOKEN = { shared: "Shared folder", waiting: "Shared folder, waiting for downloads", error: "Shared folder, can’t sync" } as const;

export const SharedFolderMark = memo(function SharedFolderMark({ groupId }: { groupId: string }) {
  const mark = useSharedFolderMark(groupId);
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  if (!mark) return null;
  const color = mark === "error" ? theme.destructive : withAlpha(tokens.groupTitle, 0.5);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={SPOKEN[mark]} style={{ marginRight: m.space.xs }}>
      <Symbol name={GLYPH[mark]} size={m.px(MARK_GLYPH)} weight="semibold" color={color} style={{ width: m.icon, height: m.px(MARK_GLYPH) }} />
    </View>
  );
});
