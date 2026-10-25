import {
  applePasswordsAvailable,
  deletePassword,
  exportPasswords,
  getNeverSavePasswordOrigins,
  getPassword,
  iCloudPasswordsExtensionSupported,
  listPasswords,
  openPasswordsApp,
  savePassword,
  setNeverSavePasswords,
  setPasswordAutofill,
  unlockPasswords,
  updatePassword,
  type SavedPassword,
} from "@ardia/ardiacore";
import { confirm, copyText, Symbol, systemInfo } from "@ardia/shell";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { engineProfile, plural } from "../../../store/model";
import type { PasswordManager } from "../../../store/settings";
import { InstallDialogHost } from "../../extensions/ExtensionOverlays";
import { addFromWebStore, setEnabled as setExtensionEnabled, useExtensionList } from "../../extensions/state";
import { importModule } from "../../import/module";
import { hostLabel, matchesQuery } from "../../pages/PageLayout";
import { Favicon, IconButton } from "../../primitives";
import { ardiaLoginCount, effectivePasswordManager, ICLOUD_PASSWORDS_EXTENSION_ID, iCloudPasswordsExtensionOf, passwordAutofill } from "../../site/passwordManager";
import { Button, Group, PopUp, Row, SearchField, SectionHeader, Sheet, TextField, Toggle } from "../controls";
import { extensionList } from "../paneData";
import { store, useResource } from "../resources";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";
import { SETTINGS_WINDOW_ID } from "../windows";

function passwordManagerAppsNote() {
  const apps = "1Password, Bitwarden, KeePassXC and Proton Pass extensions connect to their Mac apps.";
  return systemInfo().inApplicationsFolder === false
    ? `${apps} For 1Password, move Ardia to your Applications folder and reopen it (1Password only connects to browsers there), then in the 1Password app open Settings › Browser › Add Browser and choose it.`
    : `${apps} For 1Password, add Ardia once: in the 1Password app, open Settings › Browser › Add Browser and choose Ardia.`;
}

const PASSWORDS_DESCRIPTIONS: Record<PasswordManager, string> = {
  apple: "Logins come from the Passwords app and fill with Touch ID.",
  ardia: "Saved on this Mac, separately for each profile, and encrypted with a key in your Keychain.",
  none: "Your password manager's extension saves and fills logins.",
};

const OPEN_PASSWORDS_FAILED = "Couldn't open Passwords.";

const ICLOUD_EXTENSION_DESCRIPTIONS = {
  missing: "Apple's extension shows the logins saved for each site as you sign in, and offers to save new ones to Passwords.",
  off: "Turned off in Settings › Extensions. The key in login fields fills from Passwords meanwhile.",
  on: "On. Logins saved for each site show up as you sign in, and new ones save to Passwords.",
};
const FILL_WITH_EXTENSION = "Click a login field and pick one of the site's logins. Touch ID fills it.";
const NEW_LOGINS_WITH_EXTENSION = "When you sign in with a new password, or pick Use Strong Password, Passwords offers to save it.";
const CHECKING_LOGINS = "Checking…";

function savedInArdiaDescription(count: number, mode: PasswordManager) {
  const still = `${plural(count, "login")} saved in Ardia still ${count === 1 ? "fills" : "fill"}.`;
  return mode === "apple"
    ? `${still} To move them, export them, then in Passwords choose File › Import Passwords.`
    : `${still} To move them, export them, then import the file into your password manager.`;
}

const UNLOCK_MS = 5 * 60_000;
const unlockedUntil = new Map<string, number>();
const isUnlocked = (profile: string) => Date.now() < (unlockedUntil.get(profile) ?? 0);

export function PasswordsPane({ profileId: initial }: { profileId?: string | null }) {
  const theme = useTheme();
  const profiles = useProfiles();
  const mode = useBrowser((s) => effectivePasswordManager(s.settings));
  const update = useBrowser((s) => s.updateSettings);
  const appleAvailable = applePasswordsAvailable();
  const [profileId, setProfileId] = useState(() => initial ?? useBrowser.getState().settings.defaultProfileId);
  const [, setUnlockedAt] = useState(0);
  const [list, setList] = useState<SavedPassword[] | null>(null);
  const [never, setNever] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [openStatus, setOpenStatus] = useState("");
  const profile = engineProfile(profileId);
  const unlocked = isUnlocked(profile);
  const [autofill = true] = useResource(passwordAutofill, profile);
  const [loginCount] = useResource(ardiaLoginCount, profile);
  const extensionSupported = mode === "apple" && iCloudPasswordsExtensionSupported();
  const [extensionsLoaded] = useResource(extensionList, profile);
  const extensions = useExtensionList(profile);
  const iCloudExtension = iCloudPasswordsExtensionOf(extensions);
  const extensionState = !extensionSupported || extensionsLoaded === undefined ? null : !iCloudExtension ? "missing" : iCloudExtension.enabled ? "on" : "off";

  const load = () => {
    void listPasswords(profile)
      .then((passwords) => {
        setList(passwords);
        store(ardiaLoginCount, [profile], passwords.length);
      })
      .catch(() => setList([]));
    void getNeverSavePasswordOrigins(profile).then(setNever).catch(() => {});
  };
  useEffect(() => {
    if (unlocked) load();
  }, [unlocked, profileId]);
  useEffect(() => {
    if (mode !== "ardia") void listPasswords(profile).then((passwords) => store(ardiaLoginCount, [profile], passwords.length), () => {});
  }, [mode, profile]);

  const unlock = async () => {
    if (!(await unlockPasswords(profile))) return;
    unlockedUntil.set(profile, Date.now() + UNLOCK_MS);
    setUnlockedAt(Date.now());
  };

  const addICloudExtension = () => {
    void addFromWebStore(SETTINGS_WINDOW_ID, ICLOUD_PASSWORDS_EXTENSION_ID, profile);
    showSettingsSheet(<InstallDialogHost windowId={SETTINGS_WINDOW_ID} onClosed={closeSettingsSheet} />);
  };

  const openPasswords = async () => setOpenStatus((await openPasswordsApp().catch(() => false)) ? "" : OPEN_PASSWORDS_FAILED);

  const importCsv = async () => {
    const mod = importModule();
    if (!mod) return setImportStatus("Importing isn't available in this build.");
    const path = await mod.chooseImportFile("passwordsCSV");
    if (!path) return;
    try {
      const creds = await mod.importPasswordsCSV(path);
      let saved = 0;
      for (const c of creds) if (c.url && c.password && (await savePassword(profile, originOf(c.url), c.username, c.password))) saved++;
      setImportStatus(`Imported ${plural(saved, "password")}.`);
      load();
    } catch (e) {
      setImportStatus(`Couldn't import that file: ${(e as Error).message}`);
    }
  };

  const exportCsv = async () => {
    const { status, path } = await exportPasswords(profile);
    const folder = path ? path.split("/").slice(-2, -1)[0] : "";
    if (status === "succeeded") setExportStatus(`Saved to “${folder}”. Delete the file once you're done with it.`);
    else if (status === "writeFailed") setExportStatus("Couldn't write the file. Try another folder.");
    else if (status === "inProgress") setExportStatus("An export is already running.");
    else setExportStatus("");
  };

  const profilePicker =
    profiles.length > 1 ? (
      <PopUp
        value={profileId}
        options={profiles.map((p) => ({ value: p.id, title: p.name }))}
        onChange={(id) => {
          setProfileId(id);
          setExportStatus("");
          setImportStatus("");
        }}
      />
    ) : undefined;

  const savedInArdiaShown = mode !== "ardia" && ((loginCount ?? 0) > 0 || profiles.length > 1);

  return (
    <View>
      <SectionHeader title="Passwords" description={PASSWORDS_DESCRIPTIONS[mode]} action={mode === "ardia" || extensionSupported ? profilePicker : undefined} />
      <Group>
        <Row anchor="passwords.passwordManager" description={appleAvailable ? null : "Apple Passwords needs a newer version of macOS."}>
          <PopUp
            value={mode}
            options={[
              { value: "apple", title: "Apple Passwords", disabled: !appleAvailable },
              { value: "ardia", title: "Ardia" },
              { value: "none", title: "None" },
            ]}
            onChange={(passwordManager) => update({ passwordManager })}
            minWidth={150}
          />
        </Row>
        {mode === "apple" && [
          <Row key="open" anchor="passwords.openPasswords" description={openStatus || undefined}>
            <Button title="Open Passwords" onPress={() => void openPasswords()} />
          </Row>,
          extensionState && (
            <Row key="extension" anchor="passwords.iCloudExtension" description={ICLOUD_EXTENSION_DESCRIPTIONS[extensionState]}>
              {extensionState === "missing" && <Button title="Add…" onPress={addICloudExtension} />}
              {extensionState === "off" && iCloudExtension && (
                <Button title="Turn On" onPress={() => void setExtensionEnabled(profile, iCloudExtension.id, true)} />
              )}
            </Row>
          ),
          <Row key="fill" anchor="passwords.fillLogin" description={extensionState === "on" ? FILL_WITH_EXTENSION : undefined} />,
          <Row key="codes" anchor="passwords.verificationCodes" />,
          <Row key="new" anchor="passwords.newLogins" description={extensionState === "on" ? NEW_LOGINS_WITH_EXTENSION : undefined} />,
        ]}
        {mode === "ardia" && [
          <Row key="offer" anchor="passwords.offerToSave">
            <Toggle value={autofill} onChange={(v) => void setPasswordAutofill(v, profile).then(() => store(passwordAutofill, [profile], v))} />
          </Row>,
          <Row key="import" anchor="passwords.importPasswords" description={importStatus || "From a CSV exported by Chrome, Safari, Firefox, 1Password, Bitwarden…"}>
            <Button title="Import CSV…" onPress={() => void importCsv()} />
          </Row>,
          <Row key="export" anchor="passwords.exportPasswords" description={exportStatus || "To a CSV file. Anyone who can open the file can read your passwords."}>
            <Button title="Export CSV…" onPress={() => void exportCsv()} />
          </Row>,
        ]}
        {mode === "none" && <Row anchor="passwords.otherManager" />}
        {mode !== "apple" && <Row anchor="passwords.managerApps" description={passwordManagerAppsNote()} />}
      </Group>

      {savedInArdiaShown && (
        <>
          <SectionHeader title="Saved in Ardia" action={profilePicker} />
          <Group>
            {loginCount === undefined ? (
              <Row title={CHECKING_LOGINS} />
            ) : loginCount > 0 ? (
              [
                <Row key="move" anchor="passwords.moveFromArdia" description={exportStatus || savedInArdiaDescription(loginCount, mode)}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button title="Export CSV…" onPress={() => void exportCsv()} />
                    {mode === "apple" && <Button title="Open Passwords" onPress={() => void openPasswords()} />}
                  </View>
                </Row>,
                !unlocked && (
                  <Row key="unlock" anchor="passwords.showSavedInArdia">
                    <Button title="Unlock" onPress={() => void unlock()} />
                  </Row>
                ),
              ]
            ) : (
              <Row title="No logins saved in Ardia" description={profilePicker ? "Choose another profile to check its logins." : undefined} />
            )}
          </Group>
        </>
      )}

      {mode === "ardia" && !unlocked && (
        <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
          <Symbol name="lock.fill" size={26} color={theme.textTertiary} style={{ width: 36, height: 36 }} />
          <Text style={{ fontSize: 14, fontWeight: "500", color: theme.textPrimary }}>Passwords are locked</Text>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>Unlock with Touch ID or your login password to see them.</Text>
          <Button title="Unlock" kind="primary" onPress={() => void unlock()} style={{ marginTop: 6 }} />
        </View>
      )}
      {unlocked && (mode === "ardia" || (loginCount ?? 0) > 0) && (
        <SavedPasswordList profile={profile} list={list} never={never} query={query} onQuery={setQuery} onChanged={load} />
      )}
    </View>
  );
}

function SavedPasswordList({
  profile,
  list,
  never,
  query,
  onQuery,
  onChanged,
}: {
  profile: string;
  list: SavedPassword[] | null;
  never: string[];
  query: string;
  onQuery: (query: string) => void;
  onChanged: () => void;
}) {
  const shown = (list ?? []).filter((p) => matchesQuery(query, p.origin, p.username));
  return (
    <>
      <SectionHeader title={list ? plural(list.length, "Saved Password") : "Saved Passwords"} action={<SearchField value={query} onChangeText={onQuery} placeholder="Search" width={200} />} />
      <Group>
        {list && shown.length === 0 ? (
          <Row title={query ? "No passwords match" : "No saved passwords"} />
        ) : (
          shown.map((p) => (
            <Row
              key={`${p.origin}|${p.username}`}
              icon={<Favicon url={p.origin} />}
              title={hostLabel(p.origin)}
              description={p.username || "(no username)"}
              onPress={() => showSettingsSheet(<PasswordSheet profile={profile} saved={p} onChanged={onChanged} />)}
            />
          ))
        )}
      </Group>
      {never.length > 0 && (
        <>
          <SectionHeader title="Never saved" description="Sites where you chose “Never on This Site”." />
          <Group>
            {never.map((origin) => (
              <Row key={origin} icon={<Favicon url={origin} />} title={hostLabel(origin)}>
                <Button title="Remove" onPress={() => void setNeverSavePasswords(profile, origin, false).then(onChanged)} />
              </Row>
            ))}
          </Group>
        </>
      )}
    </>
  );
}

function originOf(url: string) {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url);
  return m ? m[1]! : url;
}

function PasswordSheet({ profile, saved, onChanged }: { profile: string; saved: SavedPassword; onChanged: () => void }) {
  const theme = useTheme();
  const [username, setUsername] = useState(saved.username);
  const [password, setPassword] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => void getPassword(profile, saved.origin, saved.username).then(setPassword), []);

  const save = async () => {
    await updatePassword(profile, saved.origin, saved.username, {
      username: username !== saved.username ? username : undefined,
      password: password ?? undefined,
    });
    onChanged();
    closeSettingsSheet();
  };
  const remove = async () => {
    const { confirmed } = await confirm({
      title: `Delete the password for ${hostLabel(saved.origin)}?`,
      message: "You won't be able to sign in with it automatically any more.",
      confirmTitle: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    await deletePassword(profile, saved.origin, saved.username);
    onChanged();
    closeSettingsSheet();
  };

  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Favicon url={saved.origin} size={22} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{hostLabel(saved.origin)}</Text>
      </View>
      <View style={{ marginTop: 14 }}>
        <Group>
          <Row title="Website" description={saved.origin} />
          <Row title="Username">
            {editing ? (
              <TextField value={username} onChangeText={setUsername} style={{ width: 220 }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text selectable style={{ fontSize: 13, color: theme.textPrimary }}>
                  {saved.username}
                </Text>
                <IconButton icon="doc.on.doc" size={11} box={24} radius={6} onPress={() => copyText(saved.username)} tooltip="Copy Username" />
              </View>
            )}
          </Row>
          <Row title="Password">
            {editing ? (
              <TextField value={password ?? ""} onChangeText={setPassword} secure={!revealed} style={{ width: 220 }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text selectable style={{ fontSize: 13, color: theme.textPrimary, fontFamily: revealed ? "Menlo" : undefined }}>
                  {password === null ? "…" : revealed ? password : "•".repeat(Math.min(password.length, 12))}
                </Text>
                <IconButton icon={revealed ? "eye.slash" : "eye"} size={11} box={24} radius={6} onPress={() => setRevealed(!revealed)} tooltip={revealed ? "Hide" : "Show"} />
                <IconButton icon="doc.on.doc" size={11} box={24} radius={6} onPress={() => password && copyText(password)} tooltip="Copy Password" />
              </View>
            )}
          </Row>
        </Group>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
        <Button title="Delete" kind="destructive" onPress={() => void remove()} />
        <View style={{ flex: 1 }} />
        {editing ? (
          <>
            <Button title="Cancel" onPress={() => setEditing(false)} />
            <Button title="Save" kind="primary" disabled={!password} onPress={() => void save()} />
          </>
        ) : (
          <>
            <Button title="Edit" onPress={() => setEditing(true)} />
            <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
          </>
        )}
      </View>
    </Sheet>
  );
}
