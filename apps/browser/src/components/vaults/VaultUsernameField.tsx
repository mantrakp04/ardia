import { useEffect, useState } from "react";
import { View } from "react-native";
import { stepCompletion, usernameCompletions } from "../../state/vaults/usernameSuggestions";
import { MenuRow, Text, TextField } from "../ui";
import { VAULT_SAVE } from "./tokens";

export function VaultUsernameField({
  value,
  ranked,
  onChange,
  onSubmit,
  onEscape,
  autoFocus,
  width,
}: {
  value: string;
  ranked: readonly string[];
  onChange: (text: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
  autoFocus?: boolean;
  width?: number;
}) {
  const [selected, setSelected] = useState(-1);
  const [open, setOpen] = useState(true);
  const shown = open ? usernameCompletions(ranked, value) : [];
  useEffect(() => setSelected(-1), [value]);
  const accept = (username: string) => {
    onChange(username);
    setOpen(false);
  };
  const highlighted = selected >= 0 ? shown[selected] : undefined;
  return (
    <View style={FIELD}>
      <Text size="caption" tone="textSecondary">
        Email or Username
      </Text>
      <TextField
        value={value}
        width={width}
        onChangeText={(text) => {
          setOpen(true);
          onChange(text);
        }}
        autoFocus={autoFocus}
        selectOnFocus
        onSubmit={() => (highlighted ? accept(highlighted) : onSubmit())}
        onEscape={() => (shown.length ? setOpen(false) : onEscape())}
        onArrow={(direction) => {
          if (!open) setOpen(true);
          setSelected((s) => stepCompletion(s, shown.length, direction));
        }}
        onTab={shown.length ? () => accept(highlighted ?? shown[0]!) : undefined}
      />
      {shown.length ? (
        <View>
          {shown.map((username, i) => (
            <MenuRow key={username} icon="person.crop.circle" title={username} selected={i === selected} onPress={() => accept(username)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const FIELD = { gap: VAULT_SAVE.fieldGap } as const;
