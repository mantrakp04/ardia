import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { useSettings } from "../../state/browser/hooks";
import { updateSettings } from "../../state/settings/actions";
import { Box, Button, hairline, radius, Text, useTheme } from "../ui";
import { BOOST_PANEL, CODE_FONT } from "./tokens";

type Pane = "css" | "js";
type Patch = { css?: string; js?: string };

function CodeField({ value, placeholder, onPreview, onCommit }: { value: string; placeholder: string; onPreview: (text: string) => void; onCommit: (text: string) => void }) {
  const theme = useTheme();
  const [text, setText] = useState(value);
  const latest = useRef({ text, value, onCommit });
  latest.current = { text, value, onCommit };
  const saved = useRef(value);
  useEffect(() => {
    setText((current) => (current === saved.current ? value : current));
    saved.current = value;
  }, [value]);
  useEffect(
    () => () => {
      const { text: pending, value: saved, onCommit: commit } = latest.current;
      if (pending !== saved) commit(pending);
    },
    [],
  );
  return (
    <TextInput
      multiline
      value={text}
      onChangeText={(next) => {
        setText(next);
        onPreview(next);
      }}
      onBlur={() => onCommit(text)}
      placeholder={placeholder}
      placeholderTextColor={theme.textTertiary}
      selectionColor={theme.selection}
      enableFocusRing={false}
      autoCorrect={false}
      spellCheck={false}
      style={{
        height: BOOST_PANEL.codeHeight,
        padding: 8,
        borderRadius: radius.field,
        borderWidth: hairline.ring,
        borderColor: theme.fieldBorder,
        backgroundColor: theme.field,
        color: theme.textPrimary,
        fontFamily: CODE_FONT,
        fontSize: 12,
      }}
    />
  );
}

export function BoostCode({ css, js, onPreview, onCommit }: { css: string; js: string; onPreview: (patch: Patch) => void; onCommit: (patch: Patch) => void }) {
  const [pane, setPane] = useState<Pane>("css");
  const warned = useSettings((s) => s.boostJavaScriptWarned);
  return (
    <Box gap="m">
      <Box row gap="s">
        <Button variant="text" title="CSS" plate="hover" tone={pane === "css" ? "textPrimary" : "textSecondary"} weight={pane === "css" ? "semibold" : "medium"} onPress={() => setPane("css")} />
        <Button variant="text" title="JS" plate="hover" tone={pane === "js" ? "textPrimary" : "textSecondary"} weight={pane === "js" ? "semibold" : "medium"} onPress={() => setPane("js")} />
      </Box>
      {pane === "css" ? (
        <CodeField key="css" value={css} placeholder="your css" onPreview={(text) => onPreview({ css: text })} onCommit={(text) => onCommit({ css: text })} />
      ) : warned || js ? (
        <CodeField
          key="js"
          value={js}
          placeholder={"your javascript here\n\nBoosts with JavaScript can't be shared"}
          onPreview={() => {}}
          onCommit={(text) => onCommit({ js: text })}
        />
      ) : (
        <Box gap="m" padX="l" padY="l" fill="groupFill" border="groupBorder" radius="l">
          <Text weight="medium">JavaScript runs on every page this Boost covers</Text>
          <Text size="small" tone="textSecondary">
            Lets it run code that no one has reviewed. Add only code you trust. A Boost with JavaScript can't be shared.
          </Text>
          <View style={{ alignItems: "flex-start" }}>
            <Button title="Allow JavaScript" onPress={() => updateSettings({ boostJavaScriptWarned: true })} />
          </View>
        </Box>
      )}
    </Box>
  );
}
