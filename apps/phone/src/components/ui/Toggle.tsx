import { Switch } from "react-native";
import { useTheme } from "./theme";
import { ink } from "./tokens";

export function Toggle({ value, disabled, onChange, label }: { value: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  const theme = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: theme.tertiaryFill, true: theme.formAccent }}
      thumbColor={ink.white}
      ios_backgroundColor={theme.tertiaryFill}
    />
  );
}
