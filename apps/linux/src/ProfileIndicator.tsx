import { Symbol } from "@ardia/shell";
import { openProfileMenu } from "../../browser/src/state/browser/actions";
import { openSettings } from "./settingsWindows";
import { profileNameColor, useTheme } from "../../browser/src/components/ui/theme";
import { useIsIncognito, useWindowId, useWindowProfile } from "../../browser/src/state/browser/hooks";

export { PROFILE_INDICATOR_X } from "../../browser/src/components/profiles/ProfileIndicator";

export const useProfileIndicatorWidth = (room: number) => Math.max(0, Math.min(room, 140));

export function ProfileIndicator({ room }: { room: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profile = useWindowProfile();
  const incognito = useIsIncognito();
  const name = incognito ? "Incognito" : profile?.name ?? "Personal";
  const color = !incognito && profile ? profileNameColor(profile, theme.dark) : theme.textPrimary;
  return (
    <div className="ardia-profile-controls" data-ardia-profile-controls style={{ width: useProfileIndicatorWidth(room), color }}>
      <button className="ardia-header-button ardia-current-space" data-ardia-current-space={profile?.id} aria-label={`Current space: ${name}`} title={name} onClick={() => void openProfileMenu(windowId)} disabled={incognito}>
        <span>{name}</span>
      </button>
      <button className="ardia-header-button ardia-settings-button" data-ardia-open-settings aria-label="Settings" title="Settings (Ctrl+,)" aria-keyshortcuts="Control+," onClick={() => openSettings()}>
        <Symbol name="gearshape" size={15} color={theme.icon} style={{ width: 18, height: 18 }} />
      </button>
    </div>
  );
}
