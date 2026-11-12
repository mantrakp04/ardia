import { useSettings, useTab, useTabLive } from "../../state/browser/hooks";
import { isHexColor } from "../../lib/color";
import { useTheme } from "../ui/theme";
import { toolbarPalette, type ToolbarPalette } from "../ui/toolbarColors";

export function useSiteColor(tabId: string | undefined): string | null {
  const hasUrl = useTab(tabId, (t) => !!t?.url);
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  return extendColor && hasUrl && themeColor && isHexColor(themeColor) ? themeColor : null;
}

export function useSitePalette(tabId: string): ToolbarPalette {
  return toolbarPalette(useTheme(), useSiteColor(tabId));
}
