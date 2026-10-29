import { useSettings, useTab, useTabLive } from "../../state/browser/hooks";
import { useTheme } from "../ui/theme";
import { toolbarPalette, type ToolbarPalette } from "../ui/toolbarColors";

export function useSitePalette(tabId: string): ToolbarPalette {
  const theme = useTheme();
  const hasUrl = useTab(tabId, (t) => !!t?.url);
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  return toolbarPalette(theme, extendColor && hasUrl ? themeColor : null);
}
