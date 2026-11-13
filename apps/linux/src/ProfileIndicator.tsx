import { openProfileMenu } from "../../browser/src/state/browser/actions";
import { AppMenuButton } from "./AppMenuButton";
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
      <AppMenuButton windowId={windowId} />
    </div>
  );
}
