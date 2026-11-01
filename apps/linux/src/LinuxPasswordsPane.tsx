import { View } from "react-native";
import { PasswordsPane as SharedPasswordsPane } from "../../browser/src/components/settings/panes/Passwords";
import { currentEngineProfile } from "../../browser/src/state/browser/current";
import { CredentialNotice } from "./CredentialNotice";
import { SettingsProfileWatch, useSettingsProfile } from "./settingsForm";

export function PasswordsPane(props: { profileId?: string | null }) {
  const [profileId, setProfileId] = useSettingsProfile(props.profileId);
  return (
    <View>
      <CredentialNotice kind="passwords" profile={currentEngineProfile(profileId)} />
      <SettingsProfileWatch.Provider value={setProfileId}>
        <SharedPasswordsPane {...props} />
      </SettingsProfileWatch.Provider>
    </View>
  );
}
