import { View } from "react-native";
import { AutofillPane as SharedAutofillPane } from "../../browser/src/components/settings/panes/Autofill";
import { currentEngineProfile } from "../../browser/src/state/browser/current";
import { CredentialNotice } from "./CredentialNotice";
import { SettingsProfileWatch, useSettingsProfile } from "./settingsForm";

export function AutofillPane(props: { profileId?: string | null }) {
  const [profileId, setProfileId] = useSettingsProfile(props.profileId);
  return (
    <View>
      <CredentialNotice kind="autofill" profile={currentEngineProfile(profileId)} />
      <SettingsProfileWatch.Provider value={setProfileId}>
        <SharedAutofillPane {...props} />
      </SettingsProfileWatch.Provider>
    </View>
  );
}
