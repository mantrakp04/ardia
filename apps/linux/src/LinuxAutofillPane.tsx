import { View } from "react-native";
import { AutofillPane as SharedAutofillPane } from "../../browser/src/components/settings/panes/Autofill";
import { CredentialNotice } from "./CredentialNotice";

export function AutofillPane(props: { profileId?: string | null }) {
  return (
    <View>
      <CredentialNotice kind="autofill" />
      <SharedAutofillPane {...props} />
    </View>
  );
}
