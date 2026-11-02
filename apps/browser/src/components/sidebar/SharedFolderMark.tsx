import { View } from "react-native";
import { space, Symbol, withAlpha } from "../ui";
import { useTheme } from "../ui/theme";
import { useSharedFolderMark } from "../../state/sharedFolders/hooks";
import { useSidebarTokens } from "./tokens";

const GLYPH = { shared: "person.2.fill", waiting: "icloud.and.arrow.down", error: "exclamationmark.icloud" } as const;
const SPOKEN = { shared: "Shared folder", waiting: "Shared folder, waiting for downloads", error: "Shared folder, can’t sync" } as const;

export function SharedFolderMark({ groupId }: { groupId: string }) {
  const mark = useSharedFolderMark(groupId);
  const theme = useTheme();
  const tokens = useSidebarTokens();
  if (!mark) return null;
  const color = mark === "error" ? theme.destructive : withAlpha(tokens.groupTitle, 0.5);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={SPOKEN[mark]} style={{ marginRight: space.xs }}>
      <Symbol name={GLYPH[mark]} size={10} weight="semibold" color={color} style={{ width: 16, height: 10 }} />
    </View>
  );
}
