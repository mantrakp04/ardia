import { copyText } from "../../../state/app/system";
import { focusWindow } from "../../../state/windows/nativeWindow";
import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "../../ui/theme";
import { deleteLiveFolder, manualRefresh, statusText } from "../../../state/live/engine";
import { connectGoogleDrive } from "../../../state/live/googleAuth";
import { isMocked } from "../../../state/live/net";
import { connectBitbucket, connectConfluence, connectGithub, connectNotion, disconnect, SOURCES, startGithubDeviceFlow, type DeviceFlow } from "../../../state/live/sources";
import { live, updateConfig, updateFolder, useLive } from "../../../state/live/store";
import type { LiveAccount, LiveFolder, LiveSourceId } from "../../../state/live/types";
import { useProfileRecords } from "../../../state/profiles/hooks";
import { openUrlFromSettings, settingsBrowserWindow } from "../../../state/settings/settingsWindows";
import { Button, font, Sheet, TextField, Toggle, weight } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { Group, Row, SectionHeader, SheetTitle } from "../Form";
import { setting, type SettingId } from "../settingsIndex";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { settingsType } from "../tokens";

export function LiveFoldersPane() {
  const theme = useTheme();
  const folders = useLive(useShallow((s) => s.folderOrder.map((id) => s.folders[id]!).filter(Boolean)));
  const profiles = useProfileRecords();
  useLive((s) => s.status);
  useLive((s) => s.hidden);
  const firstPullRequests = folders.find((f) => f.kind === "pullRequests")?.id;
  return (
    <View>
      <SectionHeader anchor="liveFolders.folders" />
      <View style={{ gap: 14 }}>
        {folders.map((f) => (
          <FolderGroup key={f.id} folder={f} profileName={profiles[f.profileId]?.name ?? "Profile"} searchable={f.id === firstPullRequests} />
        ))}
      </View>

      <SectionHeader title="Pull Requests" />
      <Group>
        <SourceRow id="github" />
        <SourceRow id="bitbucket" />
      </Group>

      <SectionHeader title="Documents" />
      <Group>
        <SourceRow id="notion" />
        <SourceRow id="confluence" />
        <SourceRow id="gdrive" />
      </Group>
      {isMocked ? <Text style={{ marginTop: 10, ...font.caption, color: theme.warning }}>Development build: services are served by ARDIA_TEST liveMock.</Text> : null}
    </View>
  );
}

function FolderGroup({ folder, profileName, searchable }: { folder: LiveFolder; profileName: string; searchable: boolean }) {
  return (
    <Group>
      <Row title={folder.name} description={`${profileName} · ${folder.sources.map((s) => SOURCES[s].name).join(", ")} · ${statusText(folder.id)}`}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Button title="Refresh" onPress={() => void manualRefresh(folder.id)} />
          <Button title="Delete" kind="destructive" onPress={() => deleteLiveFolder(folder.id)} />
        </View>
      </Row>
      {folder.kind === "pullRequests"
        ? [
            <FolderOption key="stacks" id="liveFolders.groupStacks" searchable={searchable} value={folder.groupStacks} onChange={(v) => updateFolder(folder.id, { groupStacks: v })} />,
            <FolderOption key="completed" id="liveFolders.showCompleted" searchable={searchable} value={folder.showCompleted} onChange={(v) => updateFolder(folder.id, { showCompleted: v })} />,
          ]
        : null}
    </Group>
  );
}

function FolderOption({ id, searchable, value, onChange }: { id: SettingId; searchable: boolean; value: boolean; onChange(value: boolean): void }) {
  const { title, description } = setting(id);
  return (
    <Row anchor={searchable ? id : undefined} title={title} description={description}>
      <Toggle value={value} onChange={onChange} />
    </Row>
  );
}

function connectedAs(id: LiveSourceId, account: LiveAccount): string {
  if (!account.name || account.name === account.login) return account.login;
  return id === "github" || id === "gdrive" ? `${account.name} (${account.login})` : account.name;
}

function SourceRow({ id }: { id: LiveSourceId }) {
  const account = useLive((s) => s.accounts[id]);
  const source = SOURCES[id];
  return (
    <Row
      anchor={`liveFolders.${id}`}
      icon={<Favicon url={source.site} size={18} />}
      title={source.name}
      description={account ? `Connected as ${connectedAs(id, account)}` : undefined}
    >
      {account ? (
        <Button title="Disconnect" onPress={() => void disconnect(id)} />
      ) : (
        <Button title="Connect…" onPress={() => showSettingsSheet(<ConnectSheet id={id} />)} />
      )}
    </Row>
  );
}


function ConnectSheet({ id }: { id: LiveSourceId }) {
  const theme = useTheme();
  const source = SOURCES[id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      closeSettingsSheet();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  let body: ReactNode;
  switch (id) {
    case "github":
      body = <GithubConnect busy={busy} run={run} />;
      break;
    case "bitbucket":
      body = <BitbucketConnect busy={busy} run={run} />;
      break;
    case "notion":
      body = <NotionConnect busy={busy} run={run} />;
      break;
    case "confluence":
      body = <ConfluenceConnect busy={busy} run={run} />;
      break;
    case "gdrive":
      body = <GoogleConnect busy={busy} run={run} />;
      break;
  }
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Favicon url={source.site} size={22} />
        <SheetTitle style={{ flex: 1 }}>Connect {source.name}</SheetTitle>
      </View>
      {body}
      {error ? <Text style={{ marginTop: 10, ...font.small, color: theme.destructive }}>{error}</Text> : null}
    </Sheet>
  );
}

type ConnectProps = { busy: boolean; run(task: () => Promise<void>): Promise<void> };

function Help({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ ...font.small, lineHeight: 17, color: theme.textSecondary, marginBottom: 10 }}>{children}</Text>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4, marginBottom: 10 }}>
      <Text style={{ ...font.small, fontWeight: weight.medium, color: theme.textPrimary }}>{label}</Text>
      {children}
    </View>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>{children}</View>;
}

function GithubConnect({ busy, run }: ConnectProps) {
  const theme = useTheme();
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState(live().config.githubClientId);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  useEffect(() => () => flow?.cancel(), [flow]);

  const signIn = () =>
    run(async () => {
      updateConfig({ githubClientId: clientId.trim() });
      const f = await startGithubDeviceFlow(clientId.trim());
      setFlow(f);
      copyText(f.userCode);
      openUrlFromSettings(f.verificationUri);
      await f.done;
    });

  if (flow) {
    return (
      <View>
        <Help>Enter this code on GitHub (it's on your clipboard), then approve Ardia. This sheet closes when you're signed in.</Help>
        <Text selectable style={{ ...settingsType.code, fontWeight: weight.semibold, letterSpacing: 3, fontFamily: "Menlo", color: theme.textPrimary, textAlign: "center", marginVertical: 8 }}>
          {flow.userCode}
        </Text>
        <Actions>
          <Button title="Cancel" onPress={() => (flow.cancel(), setFlow(null))} />
          <Button title="Open GitHub" kind="primary" onPress={() => openUrlFromSettings(flow.verificationUri)} />
        </Actions>
      </View>
    );
  }
  return (
    <View>
      <Help>
        Paste a personal access token (classic: "repo" and "read:org" scopes; fine-grained: read access to pull requests, checks and metadata).
      </Help>
      <Field label="Personal access token">
        <TextField value={token} onChangeText={setToken} placeholder="ghp_…" secure onSubmit={() => token && void run(() => connectGithub(token))} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!token.trim() || busy} onPress={() => void run(() => connectGithub(token))} />
      </Actions>
      <View style={{ height: 1, backgroundColor: theme.divider, marginVertical: 14 }} />
      <Help>Or sign in with your own GitHub OAuth app (Settings › Developer settings › OAuth Apps, with Device Flow enabled).</Help>
      <Field label="OAuth app client ID">
        <TextField value={clientId} onChangeText={setClientId} placeholder="Iv1.…" />
      </Field>
      <Actions>
        <Button title="Sign In with GitHub…" disabled={!clientId.trim() || busy} onPress={() => void signIn()} />
      </Actions>
    </View>
  );
}

function BitbucketConnect({ busy, run }: ConnectProps) {
  const [user, setUser] = useState(live().config.bitbucketUser);
  const [token, setToken] = useState("");
  const go = () => void run(() => connectBitbucket(user, token));
  return (
    <View>
      <Help>Create an API token (bitbucket.org › Personal settings › API tokens, with read access to pull requests and repositories), then enter your Atlassian account email with it. Bitbucket can't search review requests across repositories, so the folder lists your own pull requests.</Help>
      <Field label="Email or username">
        <TextField value={user} onChangeText={setUser} placeholder="you@example.com" />
      </Field>
      <Field label="API token">
        <TextField value={token} onChangeText={setToken} secure onSubmit={go} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!user.trim() || !token.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}

function NotionConnect({ busy, run }: ConnectProps) {
  const [token, setToken] = useState("");
  const go = () => void run(() => connectNotion(token));
  return (
    <View>
      <Help>Create an internal integration at notion.so/my-integrations (read content; read user information for editor names), copy its secret, and share the pages or teamspaces you want with it (••• › Connections).</Help>
      <Field label="Internal integration secret">
        <TextField value={token} onChangeText={setToken} placeholder="ntn_…" secure onSubmit={go} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!token.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}

function ConfluenceConnect({ busy, run }: ConnectProps) {
  const config = live().config;
  const [site, setSite] = useState(config.confluenceSite);
  const [email, setEmail] = useState(config.confluenceEmail);
  const [token, setToken] = useState("");
  const go = () => void run(() => connectConfluence(site, email, token));
  return (
    <View>
      <Help>Create an API token at id.atlassian.com › Security › API tokens, then enter your Confluence Cloud site and account email.</Help>
      <Field label="Site">
        <TextField value={site} onChangeText={setSite} placeholder="https://your-team.atlassian.net" />
      </Field>
      <Field label="Email">
        <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" />
      </Field>
      <Field label="API token">
        <TextField value={token} onChangeText={setToken} secure onSubmit={go} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!site.trim() || !email.trim() || !token.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}

function GoogleConnect({ busy, run }: ConnectProps) {
  const [clientId, setClientId] = useState(live().config.googleClientId);
  const [secret, setSecret] = useState("");
  const go = () =>
    void run(async () => {
      const windowId = settingsBrowserWindow();
      if (!windowId) throw new Error("Open a browser window first");
      void focusWindow(windowId);
      await connectGoogleDrive(windowId, clientId, secret);
    });
  return (
    <View>
      <Help>
        In Google Cloud Console, enable the Drive API and create an OAuth client of type "Desktop app" (add yourself as a test user). Ardia opens Google's consent page in a tab and reads the result from its redirect; it asks only to see your files' names and dates.
      </Help>
      <Field label="Client ID">
        <TextField value={clientId} onChangeText={setClientId} placeholder="…apps.googleusercontent.com" />
      </Field>
      <Field label="Client secret">
        <TextField value={secret} onChangeText={setSecret} secure />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Waiting for Google…" : "Sign In with Google…"} kind="primary" disabled={!clientId.trim() || !secret.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}
