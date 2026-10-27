import { showMenu } from "../../../state/app/system";
import { Symbol, Button, Checkbox, font, ink, Sheet, weight } from "../../ui";
import {
  copyRecoveryKit,
  copyRecoveryPhrase,
  recoveryKitPreview,
  recoveryQrCode,
  recoveryWords,
  saveRecoveryKit,
  shareRecoveryKit,
  type FolderInfo,
} from "../../../state/sync/recoveryKit";
import { useEffect, useState, type ReactNode } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { enterRecoveryPhrase, stopSync } from "../../../state/sync/engine";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { settingsType } from "../tokens";
import { useSettingsColors } from "../useSettingsColors";

const WORDS = 24;

function Title({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={{ ...font.heading, fontWeight: weight.semibold, color: theme.textPrimary }}>{children}</Text>;
}

function Body({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return <Text style={[{ ...settingsType.lead, lineHeight: 17, marginTop: 6, color: theme.textSecondary }, style]}>{children}</Text>;
}

function Buttons({ children, left }: { children: ReactNode; left?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 }}>
      {left}
      <View style={{ flex: 1 }} />
      {children}
    </View>
  );
}

export function showRecoveryKit() {
  showSettingsSheet(<RecoveryKitSheet />);
}

function RecoveryKitSheet() {
  const theme = useTheme();
  const look = useSettingsColors();
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => void recoveryKitPreview(168)?.then(setPreview), []);
  const save = async (format: "pdf" | "text") => {
    const path = await saveRecoveryKit(format);
    if (path) setSaved(path);
  };
  const more = async () => {
    const choice = await showMenu([
      { id: "copy", title: "Copy", symbol: "doc.on.doc" },
      { id: "share", title: "Share…", symbol: "square.and.arrow.up" },
      { separator: true },
      { id: "text", title: "Save as Text…", symbol: "doc.plaintext" },
    ]);
    if (choice === "copy") await copyRecoveryKit();
    else if (choice === "share") await shareRecoveryKit();
    else if (choice === "text") await save("text");
  };
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", gap: 18 }}>
        <View style={{ flex: 1 }}>
          <Title>Save Your Recovery Kit</Title>
          <Body>Your Recovery Kit contains all you need to recover your data should you lose access to this device.</Body>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              marginTop: 14,
              padding: 10,
              borderRadius: 8,
              backgroundColor: look.warningFill,
            }}
          >
            <Symbol name="exclamationmark.triangle.fill" size={12} color={theme.warning} style={{ width: 16, height: 16 }} />
            <Text style={{ flex: 1, ...font.small, lineHeight: 16, color: theme.textPrimary }}>
              Save a copy of your Recovery Kit to{" "}
              <Text style={{ textDecorationLine: "underline" }}>another</Text> device or to the cloud. You’ll need it if you lose access to this device.
            </Text>
          </View>
          {saved ? <Body style={{ marginTop: 10 }}>Saved to {saved.replace(/^\/Users\/[^/]+/, "~")}.</Body> : null}
        </View>
        <View
          accessibilityLabel="Recovery kit preview"
          style={{ width: 168, height: 217, borderRadius: 4, overflow: "hidden", borderWidth: 1, borderColor: theme.groupBorder, backgroundColor: ink.white }}
        >
          {preview ? <Image source={{ uri: preview }} style={{ width: 168, height: 217 }} /> : null}
        </View>
      </View>
      <Buttons left={<Button title="Other Options" onPress={() => void more()} />}>
        <Button title="Close" onPress={closeSettingsSheet} />
        <Button title="Save…" kind="primary" onPress={() => void save("pdf")} />
      </Buttons>
    </Sheet>
  );
}

export function showPhraseEntry(folder: FolderInfo | null, onChooseFolder?: () => void) {
  showSettingsSheet(<PhraseSheet folder={folder} onChooseFolder={onChooseFolder} />);
}

const phraseError = (r: Awaited<ReturnType<typeof enterRecoveryPhrase>>): string | null => {
  if ("ok" in r) return null;
  switch (r.error) {
    case "wordCount":
      return "Recovery phrase must be exactly 24 words.";
    case "unknownWord":
      return `“${r.word}” is not a valid recovery phrase word.`;
    case "checksum":
      return "This recovery phrase is not valid. Please check for typos.";
    case "mismatch":
      return "This recovery phrase doesn’t match the synced data in this folder. Check the phrase, or choose the folder your other devices sync to.";
    case "noData":
      return "There’s no synced data in this folder yet. Choose the folder your other devices sync to, or wait for it to finish downloading.";
    case "keychain":
      return "Couldn’t save the sync key in your Keychain.";
    case "unavailable":
      return "Sync isn’t available in this build.";
  }
};

function PhraseSheet({ folder, onChooseFolder }: { folder: FolderInfo | null; onChooseFolder?: () => void }) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = text.toLowerCase().split(/[^a-z]+/).filter(Boolean).length;
  const submit = async () => {
    if (!folder || busy) return;
    setBusy(true);
    setError(null);
    const result = await enterRecoveryPhrase(folder.path, text);
    setBusy(false);
    const message = phraseError(result);
    if (message) setError(message);
    else closeSettingsSheet();
  };
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <Title>Connect with Recovery Phrase</Title>
      <Body>Enter your 24-word recovery phrase to sync with another device.</Body>
      <View
        style={{
          marginTop: 12,
          height: 96,
          borderRadius: 7,
          padding: 8,
          backgroundColor: theme.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: error ? theme.destructive : theme.fieldBorder,
        }}
      >
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          multiline
          autoFocus
          placeholder="Enter your 24-word recovery phrase"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.selection}
          enableFocusRing={false}
          autoCorrect={false}
          spellCheck={false}
          style={{ flex: 1, ...font.body, lineHeight: 18, color: theme.textPrimary, fontFamily: "Menlo" }}
        />
      </View>
      <View style={{ flexDirection: "row", marginTop: 6 }}>
        <Text style={{ flex: 1, ...font.footnote, lineHeight: 15, color: error ? theme.destructive : theme.textSecondary }}>{error ?? ""}</Text>
        <Text style={{ ...font.footnote, color: count > WORDS ? theme.destructive : theme.textTertiary, fontVariant: ["tabular-nums"] }}>
          {count > WORDS ? "too many words" : `${count}/${WORDS} words`}
        </Text>
      </View>
      {folder ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
          <Symbol name="folder" size={11} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          <Text numberOfLines={1} style={{ flex: 1, ...font.footnote, color: theme.textSecondary }}>
            {folderLabel(folder)}
          </Text>
          {onChooseFolder ? <Button title="Change…" kind="plain" onPress={onChooseFolder} /> : null}
        </View>
      ) : null}
      <Buttons>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Connecting…" : "Connect"} kind="primary" disabled={busy || count !== WORDS || !folder} onPress={() => void submit()} />
      </Buttons>
    </Sheet>
  );
}

export function showConnectDevice() {
  showSettingsSheet(<ConnectDeviceSheet />);
}

function ConnectDeviceSheet() {
  const theme = useTheme();
  const [qr, setQr] = useState<string | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  return (
    <Sheet width={480} onClose={closeSettingsSheet}>
      <Title>Connect Another Device</Title>
      <Body>
        On your other Mac, open Ardia › Settings › Sync and choose the same sync folder. Then click Enter Recovery Phrase and enter the 24 words
        of your recovery phrase.
      </Body>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 16 }}>
        <View style={{ width: 132, height: 132, borderRadius: 8, backgroundColor: ink.white, alignItems: "center", justifyContent: "center" }}>
          {qr ? <Image source={{ uri: qr }} style={{ width: 120, height: 120 }} /> : <Button title="Show Code" onPress={() => void recoveryQrCode()?.then(setQr)} />}
        </View>
        <Text style={{ flex: 1, ...font.small, lineHeight: 16, color: theme.textSecondary }}>
          Or scan this code with your iPhone’s camera to copy the words, then paste them on your other Mac with Universal Clipboard.
        </Text>
      </View>
      {words ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 14, padding: 10, borderRadius: 8, backgroundColor: theme.groupFill }}>
          {words.map((w, i) => (
            <Text key={i} style={{ width: "25%", paddingVertical: 3, ...settingsType.lead, color: theme.textPrimary, fontFamily: "Menlo" }}>
              <Text style={{ color: theme.textTertiary }}>{`${i + 1}`.padStart(2, " ")} </Text>
              {w}
            </Text>
          ))}
        </View>
      ) : null}
      <Buttons
        left={
          <>
            <Button title={words ? "Hide Words" : "Show Words"} onPress={() => (words ? setWords(null) : void recoveryWords()?.then(setWords))} />
            <Button title="Copy Words" onPress={() => void copyRecoveryPhrase()} />
          </>
        }
      >
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </Buttons>
    </Sheet>
  );
}

export function showStopSync() {
  showSettingsSheet(<StopSheet />);
}

function StopSheet() {
  return (
    <Sheet width={420} onClose={closeSettingsSheet}>
      <Title>Stop Syncing This Device?</Title>
      <Body>
        Syncing will stop on this device. To re-enable sync, you’ll need another device that is currently syncing, or the recovery phrase from your
        Recovery Kit. Everything on this Mac stays as it is.
      </Body>
      <Buttons left={<Button title="Save Recovery Kit" onPress={() => showSettingsSheet(<RecoveryKitSheet />)} />}>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Stop Syncing" kind="destructive" onPress={() => showSettingsSheet(<DeleteDataSheet />)} />
      </Buttons>
    </Sheet>
  );
}

function DeleteDataSheet() {
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const finish = async (deleteData: boolean) => {
    setBusy(true);
    await stopSync({ deleteData });
    closeSettingsSheet();
  };
  return (
    <Sheet width={420} onClose={() => void finish(false)}>
      <Title>Delete Sync Data?</Title>
      <Body>
        Would you also like to permanently delete your synced data from the sync folder? This will stop syncing on all your other devices too. To sync
        again, you’ll need to set up each device from scratch. Your data on each Mac stays.
      </Body>
      <View style={{ marginTop: 12 }}>
        <Checkbox value={understood} onChange={setUnderstood} label="I understand this cannot be undone" />
      </View>
      <Buttons>
        <Button title="Keep Sync Data" disabled={busy} onPress={() => void finish(false)} />
        <Button title="Delete My Sync Data" kind="destructive" disabled={!understood || busy} onPress={() => void finish(true)} />
      </Buttons>
    </Sheet>
  );
}

export function folderLabel(folder: Pick<FolderInfo, "path" | "inICloud">): string {
  if (folder.inICloud) {
    const rest = folder.path.split("com~apple~CloudDocs")[1]?.split("/").filter(Boolean) ?? [];
    return ["iCloud Drive", ...rest].join(" › ");
  }
  return folder.path.replace(/^\/Users\/[^/]+/, "~");
}
