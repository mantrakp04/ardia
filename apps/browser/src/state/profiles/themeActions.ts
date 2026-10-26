import { useBrowser } from "../browser/store";
import type { ProfileColor, ProfileTheme } from "../browser/types";
import { adoptProfileTheme } from "../sync/engine";

export { holdThemedWindowsKeyLook } from "../../platform/theme";

export function setProfileTheme(profileId: string, theme: ProfileTheme | null, adopt = adoptProfileTheme) {
  adopt(profileId);
  useBrowser.getState().updateProfile(profileId, { theme });
}

export function choosePresetColor(profileId: string, color: ProfileColor, adopt = adoptProfileTheme) {
  adopt(profileId);
  useBrowser.getState().updateProfile(profileId, { color, theme: null });
}
