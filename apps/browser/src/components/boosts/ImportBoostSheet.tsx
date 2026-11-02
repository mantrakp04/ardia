import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { boostChanges, siteLine } from "../../state/boostUi/describe";
import { installBoost, previewImport } from "../../state/boostUi/importCode";
import { closeSettingsSheet } from "../../state/settings/sheet";
import { Box, Button, DialogActions, DialogTitle, font, hairline, radius, Sheet, space, Text, useTheme } from "../ui";
import { CODE_FONT, IMPORT_SHEET } from "./tokens";

export function ImportBoostSheet({ profileId, initialCode = "" }: { profileId: string; initialCode?: string }) {
  const theme = useTheme();
  const [code, setCode] = useState(initialCode);
  useEffect(() => setCode(initialCode), [initialCode]);
  const result = previewImport(code);
  const boost = result && !("error" in result) ? result : null;
  const changes = boost ? boostChanges(boost) : [];
  return (
    <Sheet size="s" onClose={closeSettingsSheet}>
      <DialogTitle>Import Boost</DialogTitle>
      <Text size="small" tone="textSecondary" style={{ marginTop: space.s, marginBottom: space.l }}>
        Paste a share code or a link from ardia.dev. You'll see what it changes before it's added.
      </Text>
      <TextInput
        multiline
        autoFocus
        value={code}
        onChangeText={setCode}
        placeholder="ardia-boost:1:…"
        placeholderTextColor={theme.textTertiary}
        selectionColor={theme.selection}
        enableFocusRing={false}
        autoCorrect={false}
        spellCheck={false}
        style={{
          height: IMPORT_SHEET.codeHeight,
          padding: space.m,
          borderRadius: radius.control,
          borderWidth: hairline.ring,
          borderColor: theme.fieldBorder,
          backgroundColor: theme.field,
          color: theme.textPrimary,
          fontFamily: CODE_FONT,
          fontSize: font.small.fontSize,
        }}
      />
      {result && "error" in result ? (
        <Text size="small" tone="destructive" style={{ marginTop: space.ml }}>
          {result.error}
        </Text>
      ) : null}
      {boost ? (
        <Box gap="xs" padX="l" padY="l" fill="groupFill" border="groupBorder" radius="panel" style={{ marginTop: space.l }}>
          <Text weight="semibold">{boost.name}</Text>
          {boost.author ? (
            <Text size="small" tone="textSecondary">
              {`By ${boost.author}`}
            </Text>
          ) : null}
          <Text size="small" tone="textSecondary">
            {`Applies to ${siteLine(boost)}`}
          </Text>
          <View style={{ marginTop: space.xs, gap: space.xxs }}>
            {(changes.length ? changes : ["Doesn't change anything"]).map((line) => (
              <Text key={line} size="small">
                {`• ${line}`}
              </Text>
            ))}
          </View>
        </Box>
      ) : null}
      <DialogActions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button
          title="Add Boost"
          kind="primary"
          disabled={!boost}
          onPress={() => {
            if (!boost) return;
            installBoost(profileId, boost);
            closeSettingsSheet();
          }}
        />
      </DialogActions>
    </Sheet>
  );
}
