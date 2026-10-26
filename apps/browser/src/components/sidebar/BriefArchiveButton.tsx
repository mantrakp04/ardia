import { Pressable } from "react-native";
import { useWindow } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { Symbol } from "../ui";
import { useTheme } from "../ui/theme";

export function BriefArchiveButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const open = useSidebarUi((s) => s.briefArchive === windowId);
  const available = useWindow(windowId, (window) => !!window && !window.incognito && window.kind !== "small" && !isIncognitoProfile(window.profileId));
  if (!available) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="Daily brief archive" tooltip="Daily Briefs" onPress={() => setSidebarUi({ briefArchive: open ? null : windowId })} style={{ position: "absolute", left: 13, bottom: 5, width: 31, height: 31, alignItems: "center", justifyContent: "center", borderRadius: 7, backgroundColor: open ? theme.tabHover : undefined }}><Symbol name="doc.text" size={19} color={theme.textSecondary} /></Pressable>;
}
