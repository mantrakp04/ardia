import { View } from "react-native";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { Checkbox, space, Text } from "../../ui";
import { Anchor, Row } from "../Form";
import { setting, type SettingId } from "../settingsIndex";

type SuggestKey = "vaultSuggestLogins" | "vaultSuggestCodes" | "vaultSuggestUsernames" | "vaultSuggestNewPasswords" | "vaultContextGenerate" | "vaultSuggestGenerated" | "vaultSuggestOnFocus";

function SuggestCheckbox({ anchor, settingKey, disabled, nested }: { anchor: SettingId; settingKey: SuggestKey; disabled?: boolean; nested?: boolean }) {
  const value = useSettings((s) => s[settingKey]);
  return (
    <Anchor id={anchor} shape="row">
      <View style={nested ? NESTED : undefined}>
        <Checkbox value={value} disabled={disabled} label={setting(anchor).title} onChange={(on) => updateSettings({ [settingKey]: on })} />
      </View>
    </Anchor>
  );
}

export function VaultSuggestRow() {
  const newPasswords = useSettings((s) => s.vaultSuggestNewPasswords);
  const entry = setting("passwords.vaultSuggest");
  return (
    <Row
      anchor="passwords.vaultSuggest"
      description={
        <View>
          <Text size="caption" tone="textSecondary" style={CAPTION}>
            {entry.description}
          </Text>
          <View style={LIST}>
            <SuggestCheckbox anchor="passwords.vaultSuggestLogins" settingKey="vaultSuggestLogins" />
            <SuggestCheckbox anchor="passwords.vaultSuggestCodes" settingKey="vaultSuggestCodes" />
            <SuggestCheckbox anchor="passwords.vaultSuggestUsernames" settingKey="vaultSuggestUsernames" />
            <SuggestCheckbox anchor="passwords.vaultSuggestNewPasswords" settingKey="vaultSuggestNewPasswords" />
            <SuggestCheckbox anchor="passwords.vaultContextGenerate" settingKey="vaultContextGenerate" disabled={!newPasswords} nested />
            <SuggestCheckbox anchor="passwords.vaultSuggestGenerated" settingKey="vaultSuggestGenerated" />
          </View>
          <View style={LIST}>
            <SuggestCheckbox anchor="passwords.vaultSuggestOnFocus" settingKey="vaultSuggestOnFocus" />
          </View>
        </View>
      }
    />
  );
}

const CAPTION = { marginTop: space.xxs } as const;
const LIST = { marginTop: space.m, gap: space.s } as const;
const NESTED = { paddingLeft: space.xxl + space.xxs } as const;
