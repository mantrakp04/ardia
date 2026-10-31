import { useBrowser } from "../browser/store";
import type { ProfileColor, ProfileTheme } from "../browser/types";
import { adoptProfileTheme } from "../sync/engine";

export { holdThemedWindowsKeyLook } from "../../platform/theme";

export function setProfileTheme(spaceId: string, theme: ProfileTheme | null, adopt = adoptProfileTheme) {
  adopt(spaceId);
  useBrowser.getState().updateSpace(spaceId, { theme });
}

export function choosePresetColor(spaceId: string, color: ProfileColor, adopt = adoptProfileTheme) {
  adopt(spaceId);
  useBrowser.getState().updateSpace(spaceId, { color, theme: null });
}
