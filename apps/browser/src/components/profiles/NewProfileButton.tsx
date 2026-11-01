import { switchProfile } from "../../state/browser/actions";
import { requestCreateProfile } from "../../state/profiles/createProfileRequest";
import { trackProfileCreated } from "../../state/telemetry/track";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { Button } from "../ui";
import { profileSwitcher } from "./tokens";

async function createProfileFromFooter(windowId: string) {
  const id = await requestCreateProfile(windowId);
  if (!id) return;
  trackProfileCreated("sidebar_footer");
  switchProfile(windowId, id);
}

export function NewProfileButton({ windowId }: { windowId: string }) {
  return (
    <Button variant="icon"
      icon="plus"
      size={profileSwitcher.newProfileIcon}
      box={SIDEBAR_FOOTER_DOWNLOADS.size}
      radius={profileSwitcher.newProfileRadius}
      tooltip="New Profile"
      onPress={() => void createProfileFromFooter(windowId)}
    />
  );
}
