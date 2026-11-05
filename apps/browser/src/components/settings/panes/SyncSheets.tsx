import { showMenu } from "../../../state/app/system";
import { Box, Button, Checkbox, DialogActions, DialogTitle, ink, lineHeight, proseLineHeight, radius, Sheet, space, Symbol, tabularNums, Text, TextField } from "../../ui";
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
import { Image, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { addRemoteProfile, enterRecoveryPhrase, stopSync, useSync } from "../../../state/sync/engine";
import type { RemoteProfile } from "../../../state/sync/syncDoc";
import { ProfileBadge } from "../../profiles/ProfileIcons";
import { Group, Row } from "../Form";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { useSettingsColors } from "../useSettingsColors";

const WORDS = 24;

function Body({ children }: { children: ReactNode }) {
  return (
    <Text size="small" tone="textSecondary" style={BODY}>
      {children}
    </Text>
  );
}

const BODY = { lineHeight: proseLineHeight.small, marginTop: space.ml } as const;
const PREVIEW = { width: 168, height: 217 } as const;
const PREVIEW_FRAME = { ...PREVIEW, borderRadius: radius.control, overflow: "hidden", borderWidth: 1, backgroundColor: ink.white } as const;
const WARNING_TEXT = { flex: 1, lineHeight: lineHeight.body } as const;
const UNDERLINE = { textDecorationLine: "underline" } as const;
const SECTION_TOP = { marginTop: space.xl } as const;
const PHRASE_FOOT = { marginTop: space.s } as const;
const PHRASE_ERROR = { flex: 1, lineHeight: lineHeight.caption } as const;
const FOLDER_ROW = { alignItems: "center", marginTop: space.ml } as const;
const FILL = { flex: 1 } as const;
const QR_BOX = { width: 132, height: 132, borderRadius: radius.tile, backgroundColor: ink.white, alignItems: "center", justifyContent: "center" } as const;
const QR = { width: 120, height: 120 } as const;
const QR_NOTE = { flex: 1, lineHeight: lineHeight.body } as const;
const WORDS_BOX = { flexWrap: "wrap", marginTop: space.xl } as const;
const WORD = { width: "25%", paddingVertical: space.xs, fontFamily: "Menlo" } as const;
const CHECK_TOP = { marginTop: space.l } as const;

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
    <Sheet size="l" onClose={closeSettingsSheet}>
      <Box row gap="xl">
        <View style={FILL}>
          <DialogTitle subtitle="Your Recovery Kit contains all you need to recover your data should you lose access to this device.">Save Your Recovery Kit</DialogTitle>
          <Box row gap="m" pad="ml" radius="panel" style={[SECTION_TOP, { backgroundColor: look.warningFill }]}>
            <Symbol name="exclamationmark.triangle.fill" size={12} color={theme.warning} style={{ width: 16, height: 16 }} />
            <Text size="small" style={WARNING_TEXT}>
              Save a copy of your Recovery Kit to{" "}
              <Text size="small" style={UNDERLINE}>
                another
              </Text>{" "}
              device or to the cloud. You’ll need it if you lose access to this device.
            </Text>
          </Box>
          {saved ? <Body>Saved to {saved.replace(/^\/Users\/[^/]+/, "~")}.</Body> : null}
        </View>
        <View accessibilityLabel="Recovery kit preview" style={[PREVIEW_FRAME, { borderColor: theme.groupBorder }]}>
          {preview ? <Image source={{ uri: preview }} style={PREVIEW} /> : null}
        </View>
      </Box>
      <DialogActions leading={<Button title="Other Options" onPress={() => void more()} />}>
        <Button title="Close" onPress={closeSettingsSheet} />
        <Button title="Save…" kind="primary" onPress={() => void save("pdf")} />
      </DialogActions>
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
  const [joined, setJoined] = useState(false);
  const syncing = useSync((s) => s.enabled);
  const count = text.toLowerCase().split(/[^a-z]+/).filter(Boolean).length;
  const submit = async () => {
    if (!folder || busy) return;
    setBusy(true);
    setError(null);
    const joining = !syncing;
    const result = await enterRecoveryPhrase(folder.path, text);
    setBusy(false);
    const message = phraseError(result);
    if (message) setError(message);
    else if (joining) setJoined(true);
    else closeSettingsSheet();
  };
  if (joined) return <JoinedSheet />;
  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle subtitle="Enter your 24-word recovery phrase to sync with another device.">Connect with Recovery Phrase</DialogTitle>
      <View style={CHECK_TOP}>
        <TextField
          multiline
          mono
          invalid={!!error}
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          autoFocus
          placeholder="Enter your 24-word recovery phrase"
        />
      </View>
      <Box row style={PHRASE_FOOT}>
        <Text size="caption" tone={error ? "destructive" : "textSecondary"} style={PHRASE_ERROR}>
          {error ?? ""}
        </Text>
        <Text size="caption" tone={count > WORDS ? "destructive" : "textTertiary"} style={tabularNums}>
          {count > WORDS ? "too many words" : `${count}/${WORDS} words`}
        </Text>
      </Box>
      {folder ? (
        <Box row gap="s" style={FOLDER_ROW}>
          <Symbol name="folder" size={11} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          <Text size="caption" tone="textSecondary" lines={1} style={FILL}>
            {folderLabel(folder)}
          </Text>
          {onChooseFolder ? <Button title="Change…" kind="plain" onPress={onChooseFolder} /> : null}
        </Box>
      ) : null}
      <DialogActions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Connecting…" : "Connect"} kind="primary" disabled={busy || count !== WORDS || !folder} onPress={() => void submit()} />
      </DialogActions>
    </Sheet>
  );
}

export function remoteProfileDescription(p: Pick<RemoteProfile, "sharesWith" | "waiting">): string {
  if (p.waiting) return "On your other devices. Waiting for the profile it shares data with to sync.";
  if (!p.sharesWith) return "On your other devices";
  const { name, added } = p.sharesWith;
  return added ? `On your other devices. Shares data with ${name}, which is added too.` : `On your other devices. Shares data with ${name}.`;
}

export function addAllRemoteProfiles(profiles: RemoteProfile[]) {
  for (const p of profiles) if (!p.waiting) addRemoteProfile(p.syncId);
}

export function RemoteProfileRow({ profile }: { profile: RemoteProfile }) {
  return (
    <Row
      icon={<ProfileBadge profile={{ name: profile.name, color: profile.color, icon: profile.icon }} size={24} />}
      title={profile.name}
      description={remoteProfileDescription(profile)}
    >
      <Button title="Add to This Mac" disabled={!!profile.waiting} onPress={() => addRemoteProfile(profile.syncId)} />
    </Row>
  );
}

export function lookingForProfiles(pending: number): string {
  const looking = "Looking for the profiles on your other devices…";
  return pending ? `${looking} Waiting for ${pending === 1 ? "1 file" : `${pending} files`} to download.` : looking;
}

function joinedMessage(found: number, joining: boolean, pending: number, error: string | null): string {
  if (found) return "These profiles are on your other devices. Add them to this Mac to sync their pinned tabs, bookmarks, history and passwords here too.";
  if (error) return error;
  if (joining) return lookingForProfiles(pending);
  return "Every profile on your other devices is on this Mac too.";
}

function JoinedSheet() {
  const remote = useSync((s) => s.remoteProfiles);
  const joining = useSync((s) => s.joining);
  const pending = useSync((s) => s.pending);
  const error = useSync((s) => (s.status === "stalled" ? s.error : null));
  const addable = remote.filter((p) => !p.waiting).length;
  return (
    <Sheet size="l" onClose={closeSettingsSheet}>
      <DialogTitle subtitle={joinedMessage(remote.length, joining, pending, error)}>This Mac Is Syncing</DialogTitle>
      {remote.length ? (
        <View style={SECTION_TOP}>
          <Group>
            {remote.map((p) => (
              <RemoteProfileRow key={p.syncId} profile={p} />
            ))}
          </Group>
        </View>
      ) : null}
      <DialogActions>
        <Button title="Done" kind={addable > 1 ? "default" : "primary"} onPress={closeSettingsSheet} />
        {addable > 1 ? <Button title="Add All" kind="primary" onPress={() => addAllRemoteProfiles(remote)} /> : null}
      </DialogActions>
    </Sheet>
  );
}

export function showConnectDevice() {
  showSettingsSheet(<ConnectDeviceSheet />);
}

function ConnectDeviceSheet() {
  const [qr, setQr] = useState<string | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  return (
    <Sheet size="l" onClose={closeSettingsSheet}>
      <DialogTitle
        subtitle="On your other Mac, open Ardia › Settings › Sync and choose the same sync folder. Then click Enter Recovery Phrase and enter the 24 words of your recovery phrase."
      >
        Connect Another Device
      </DialogTitle>
      <Box row gap="xl" style={[SECTION_TOP, { alignItems: "center" }]}>
        <View style={QR_BOX}>{qr ? <Image source={{ uri: qr }} style={QR} /> : <Button title="Show Code" onPress={() => void recoveryQrCode()?.then(setQr)} />}</View>
        <Text size="small" tone="textSecondary" style={QR_NOTE}>
          Or scan this code with your iPhone’s camera to copy the words, then paste them on your other Mac with Universal Clipboard.
        </Text>
      </Box>
      {words ? (
        <Box row pad="ml" radius="tile" fill="groupFill" style={WORDS_BOX}>
          {words.map((w, i) => (
            <Text key={i} size="small" style={WORD}>
              <Text size="small" tone="textTertiary">{`${`${i + 1}`.padStart(2, " ")} `}</Text>
              {w}
            </Text>
          ))}
        </Box>
      ) : null}
      <DialogActions
        leading={
          <>
            <Button title={words ? "Hide Words" : "Show Words"} onPress={() => (words ? setWords(null) : void recoveryWords()?.then(setWords))} />
            <Button title="Copy Words" onPress={() => void copyRecoveryPhrase()} />
          </>
        }
      >
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </DialogActions>
    </Sheet>
  );
}

export function showStopSync() {
  showSettingsSheet(<StopSheet />);
}

function StopSheet() {
  return (
    <Sheet size="s" onClose={closeSettingsSheet}>
      <DialogTitle subtitle="Syncing will stop on this device. To re-enable sync, you’ll need another device that is currently syncing, or the recovery phrase from your Recovery Kit. Everything on this Mac stays as it is.">
        Stop Syncing This Device?
      </DialogTitle>
      <DialogActions leading={<Button title="Save Recovery Kit" onPress={() => showSettingsSheet(<RecoveryKitSheet />)} />}>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Stop Syncing" kind="destructive" onPress={() => showSettingsSheet(<DeleteDataSheet />)} />
      </DialogActions>
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
    <Sheet size="s" onClose={() => void finish(false)}>
      <DialogTitle subtitle="Would you also like to permanently delete your synced data from the sync folder? This will stop syncing on all your other devices too. To sync again, you’ll need to set up each device from scratch. Your data on each Mac stays.">
        Delete Sync Data?
      </DialogTitle>
      <View style={CHECK_TOP}>
        <Checkbox value={understood} onChange={setUnderstood} label="I understand this cannot be undone" />
      </View>
      <DialogActions>
        <Button title="Keep Sync Data" disabled={busy} onPress={() => void finish(false)} />
        <Button title="Delete My Sync Data" kind="destructive" disabled={!understood || busy} onPress={() => void finish(true)} />
      </DialogActions>
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
