import { View } from "react-native";
import { PasswordsPane as SharedPasswordsPane } from "../../browser/src/components/settings/panes/Passwords";
import { CredentialNotice } from "./CredentialNotice";

export function PasswordsPane(props: { profileId?: string | null }) {
  return (
    <View>
      <CredentialNotice kind="passwords" />
      <SharedPasswordsPane {...props} />
    </View>
  );
}
