import { briefProviderStatus, cancelChatGPTSignIn, cancelGmailCollection, cancelGmailSignIn, connectChatGPT, connectGmail, disconnectChatGPT, disconnectGmail, gmailStatus, type BriefProviderStatus, type GmailStatus } from "../../../state/briefs/connections";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { openExternalURL } from "../../../state/app/system";
import { openBriefAuthorization as openAuthorization, openTodayBrief as openToday, saveGmailBriefPermission, setBriefSourcePermission } from "../../../state/briefs/settingsActions";
import { useTheme } from "../../ui/theme";
import { connectCalendar, useCalendar } from "../../../state/live/calendar";
import { useLive } from "../../../state/live/store";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings as update } from "../../../state/settings/actions";
import { Button, Checkbox, Group, PopUp, Sheet, TextField, Toggle } from "../../ui";
import { Row, SectionHeader } from "../Form";
import { connectClaudeKey, disconnectClaude, hasClaudeKey } from "../../../state/briefs/briefContext";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { ConnectSheet } from "./LiveFolders";

type Source = "gmail" | "calendar" | "github";

const SOURCE_ANCHORS: Record<Source, string> = { gmail: "dailyBriefs.gmail", calendar: "dailyBriefs.calendar", github: "dailyBriefs.github" };
const SOURCE_NAMES: Record<Source, string> = { gmail: "Gmail", calendar: "Calendar", github: "GitHub" };
const SOURCE_DETAILS: Record<Source, string> = {
  gmail: "Google will ask you to let Ardia read Gmail. Ardia uses the sender, subject, date and snippet of up to 15 recent inbox messages for your brief. It does not send or delete mail or read attachments. Approving Google access does not give permission to share mail with your brief provider.",
  calendar: "Ardia reads events from accounts in the macOS Calendar app, including Google Calendar. macOS grants full calendar access; Ardia uses this integration to read events. This is separate from permission to include event details in a brief.",
  github: "Connect through GitHub's account permission screen. The current sign-in requests repo and read:org access; review the permissions before approving. Connecting GitHub and allowing its data in a brief are separate choices.",
};

export function DailyBriefsPane() {
  const theme = useTheme();
  const settings = useSettings((s) => s);
  const provider = settings.dailyBriefProvider === "claude" ? "Claude" : "ChatGPT";
  const [status, setStatus] = useState<BriefProviderStatus | null>(null);
  const [claudeConnected, setClaudeConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const refreshProvider = async () => {
    const [chatgpt, claude] = await Promise.all([briefProviderStatus().catch(() => null), hasClaudeKey().catch(() => false)]);
    setStatus(chatgpt);
    setClaudeConnected(claude);
  };
  useEffect(() => { void refreshProvider(); }, []);
  const connected = settings.dailyBriefProvider === "claude" ? claudeConnected : status?.connected;
  const signIn = async () => {
    setBusy(true);
    setProviderError(null);
    try {
      setStatus(await connectChatGPT(openAuthorization));
    } catch (error) {
      setProviderError(String((error as Error)?.message ?? "ChatGPT sign-in did not complete."));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setProviderError(null);
    try {
      if (settings.dailyBriefProvider === "claude") await disconnectClaude();
      else if (!(await disconnectChatGPT())) setProviderError("Signed out locally. Remote access could not be revoked; review your ChatGPT connections.");
      update({ dailyBriefSources: { gmail: false, calendar: false, github: false } });
      await refreshProvider();
    } catch {
      setProviderError("The provider could not be disconnected. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <SectionHeader title="Daily Briefs" description="A little perspective for the day ahead. Choose when your brief arrives and which sources it can use." />
      <Group>
        <Row anchor="dailyBriefs.enabled"><Toggle value={settings.dailyBriefEnabled} onChange={(dailyBriefEnabled) => update({ dailyBriefEnabled })} /></Row>
        <Row anchor="dailyBriefs.delivery">
          <PopUp value={settings.dailyBriefDelivery} options={[{ value: "scheduled", title: "At a Set Time" }, { value: "onOpen", title: "When I Open Ardia" }]} onChange={(dailyBriefDelivery) => update({ dailyBriefDelivery })} minWidth={174} />
        </Row>
        <Row anchor="dailyBriefs.time"><BriefTime disabled={settings.dailyBriefDelivery !== "scheduled"} value={settings.dailyBriefTime} onChange={(dailyBriefTime) => update({ dailyBriefTime })} /></Row>
        <Row anchor="dailyBriefs.open"><Button title="Open Brief" onPress={openToday} /></Row>
      </Group>
      <SectionHeader title="Provider" description="Your selected provider receives only the sources you explicitly allow below. Connecting an account and sharing its data are separate permissions." />
      <Group>
        <Row anchor="dailyBriefs.provider"><PopUp value={settings.dailyBriefProvider} disabled={busy} options={[{ value: "chatgpt", title: "ChatGPT" }, { value: "claude", title: "Claude" }]} onChange={(dailyBriefProvider) => update({ dailyBriefProvider, dailyBriefSources: { gmail: false, calendar: false, github: false } })} minWidth={140} /></Row>
        <Row anchor="dailyBriefs.providerAccount" title={provider} description={connected ? settings.dailyBriefProvider === "chatgpt" ? `Connected${status?.email ? ` as ${status.email}` : ""} · Plan eligibility checked when generating` : "API key saved in Keychain · Billed through Claude Console" : settings.dailyBriefProvider === "chatgpt" ? "Sign in with ChatGPT to use your eligible existing plan." : "Use your own API key. Claude subscriptions do not include API access; API usage is billed separately."}>
          {connected ? <Button title="Disconnect" disabled={busy} onPress={() => void disconnect()} /> : settings.dailyBriefProvider === "chatgpt" ? <Button title={busy ? "Cancel Sign-In" : "Sign In…"} onPress={() => busy ? void cancelChatGPTSignIn().catch(() => {}) : void signIn()} /> : <Button title="Add API Key…" onPress={() => showSettingsSheet(<ClaudeKeySheet onSaved={() => void refreshProvider()} />)} />}
        </Row>
      </Group>
      {providerError ? <Text style={{ marginTop: 10, fontSize: 12, lineHeight: 17, color: theme.destructive }}>{providerError}</Text> : null}
      <SectionHeader title="Connected sources" description="Only sources you allow here are shared with your selected provider when generating. Revoke permission here at any time; this does not disconnect your other Ardia features." />
      <Group>
        <SourceRow source="gmail" />
        <SourceRow source="calendar" />
        <SourceRow source="github" />
      </Group>
      <Text style={{ marginTop: 12, fontSize: 11.5, lineHeight: 17, color: theme.textSecondary }}>Gmail connects through Google’s permission screen in your system browser. Your Google account does not need a separate Ardia profile.</Text>
    </View>
  );
}

function BriefTime({ value, onChange, disabled }: { value: string; onChange(value: string): void; disabled?: boolean }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    if (disabled) return;
    const match = /^(\d{1,2}):(\d{2})$/.exec(draft.trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return setInvalid(true);
    onChange(`${match[1]!.padStart(2, "0")}:${match[2]}`);
    setInvalid(false);
  };
  return (
    <View style={{ width: 100, gap: 4 }}>
      <TextField disabled={disabled} value={draft} onChangeText={(v) => { setDraft(v); setInvalid(false); }} onSubmit={save} onBlur={save} placeholder="08:00" />
      {invalid ? <Text style={{ fontSize: 10, color: theme.textSecondary }}>Use 00:00–23:59</Text> : null}
    </View>
  );
}

function SourceRow({ source }: { source: Source }) {
  const consent = useSettings((s) => s.dailyBriefSources?.[source] ?? false);
  const github = useLive((s) => s.accounts.github);
  const calendar = useCalendar((s) => s.access);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  useEffect(() => { if (source === "gmail") void gmailStatus().then(setGmail).catch(() => {}); }, [source]);
  const connected = source === "gmail" ? !!gmail?.connected : source === "github" ? !!github : calendar === "fullAccess" || calendar === "fixture";
  const account = source === "gmail" ? gmail?.email || "Connected to Gmail" : source === "github" ? github?.login : "Connected through macOS Calendar";
  const description = connected ? `${account} · ${consent ? "Allowed for briefs" : "Not shared with briefs"}` : `Not connected${consent ? " · Brief permission saved" : ""}`;
  return (
    <Row anchor={SOURCE_ANCHORS[source]} description={description}>
      <Button title={connected ? "Manage…" : "Connect…"} onPress={() => showSettingsSheet(source === "gmail" ? <GmailPermission initial={gmail} onChanged={setGmail} /> : source === "github" && !connected ? <ConnectSheet id="github" /> : <SourcePermission source={source} />)} />
    </Row>
  );
}

function SourcePermission({ source }: { source: Exclude<Source, "gmail"> }) {
  const theme = useTheme();
  const saved = useSettings((s) => s.dailyBriefSources?.[source] ?? false);
  const provider = useSettings((s) => s.dailyBriefProvider === "claude" ? "Claude" : "ChatGPT");
  const [allowed, setAllowed] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const github = useLive((s) => s.accounts.github);
  const calendar = useCalendar((s) => s.access);
  const connected = source === "github" ? !!github : calendar === "fullAccess" || calendar === "fixture";
  const save = () => {
    setBriefSourcePermission(source, allowed);
  };
  const connect = async () => {
    save();
    if (source === "github") return showSettingsSheet(<ConnectSheet id="github" />);
    if (source !== "calendar") return;
    setBusy(true);
    setError(null);
    try {
      if (await connectCalendar()) closeSettingsSheet();
      else setError("Calendar permission was not granted. You can change it in System Settings › Privacy & Security › Calendars.");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet width={470} onClose={closeSettingsSheet}>
      <Text style={{ fontSize: 17, fontWeight: "600", color: theme.textPrimary, marginBottom: 12 }}>{SOURCE_NAMES[source]} for your daily brief</Text>
      <Text style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary, marginBottom: 16 }}>{SOURCE_DETAILS[source]}</Text>
      <Checkbox value={allowed} onChange={setAllowed} label={`Allow this source in briefs generated with ${provider}`} />
      <Text style={{ fontSize: 11.5, lineHeight: 17, color: theme.textSecondary, marginTop: 10 }}>Selected content will be sent to the provider you choose in settings. Changing providers clears this permission. Revoking permission stops future requests; content already sent to a provider cannot be recalled.</Text>
      {error ? <Text style={{ fontSize: 12, lineHeight: 17, color: theme.destructive, marginTop: 12 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Button title="Cancel" disabled={busy} onPress={closeSettingsSheet} />
        {source === "github" ? <><Button title={connected ? "Reconnect GitHub…" : "Connect GitHub…"} disabled={busy} onPress={() => void connect()} /><Button title="Save Permission" kind="primary" disabled={busy} onPress={() => { save(); closeSettingsSheet(); }} /></> : !connected && allowed ? <Button title={busy ? "Connecting…" : "Continue to Connect…"} kind="primary" disabled={busy} onPress={() => void connect()} /> : <Button title="Save Permission" kind="primary" disabled={busy} onPress={() => { save(); closeSettingsSheet(); }} />}
      </View>
    </Sheet>
  );
}

function GmailPermission({ initial, onChanged }: { initial: GmailStatus | null; onChanged(status: GmailStatus): void }) {
  const theme = useTheme();
  const saved = useSettings((s) => s.dailyBriefSources?.gmail ?? false);
  const provider = useSettings((s) => s.dailyBriefProvider === "claude" ? "Claude" : "ChatGPT");
  const [status, setStatus] = useState(initial);
  const [allowed, setAllowed] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const revision = useRef(0);
  useEffect(() => { setAllowed(saved); }, [saved, provider]);
  useEffect(() => {
    const current = revision.current;
    void gmailStatus().then((value) => { if (active.current && revision.current === current) setStatus(value); }).catch((reason) => { if (active.current && revision.current === current) setError(String(reason?.message ?? reason)); });
    return () => { active.current = false; void cancelGmailSignIn().catch(() => {}); };
  }, []);
  const clearSharing = () => {
    setBriefSourcePermission("gmail", false);
    setAllowed(false);
    void cancelGmailCollection().catch(() => {});
  };
  const connect = async () => {
    revision.current++;
    clearSharing();
    setBusy(true);
    setError(null);
    try {
      const value = await connectGmail();
      if (!active.current) return;
      setStatus(value);
      onChanged(value);
    } catch (reason) {
      if (active.current) {
        setError(String((reason as Error)?.message ?? reason));
        void gmailStatus().then((value) => { if (active.current) { setStatus(value); onChanged(value); } }).catch(() => {});
      }
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const disconnect = async () => {
    revision.current++;
    clearSharing();
    setBusy(true);
    setDisconnecting(true);
    setError(null);
    try {
      const revoked = await disconnectGmail();
      const value = await gmailStatus();
      if (!active.current) return;
      setStatus(value);
      onChanged(value);
      if (!revoked) setError("Disconnected locally. Google could not confirm access was revoked; review your Google Account connections.");
    } catch (reason) {
      if (active.current) setError(String((reason as Error)?.message ?? reason));
    } finally {
      if (active.current) { setBusy(false); setDisconnecting(false); }
    }
  };
  const save = () => {
    saveGmailBriefPermission(!!status?.connected, allowed, provider);
    if (!allowed) void cancelGmailCollection().catch(() => {});
    closeSettingsSheet();
  };
  return <Sheet width={470} onClose={disconnecting ? () => {} : closeSettingsSheet}>
    <Text style={{ fontSize: 17, fontWeight: "600", color: theme.textPrimary, marginBottom: 12 }}>Gmail for your daily brief</Text>
    <Text style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary, marginBottom: 14 }}>{SOURCE_DETAILS.gmail}</Text>
    {status?.connected ? <Text style={{ fontSize: 12, color: theme.textPrimary, marginBottom: 14 }}>Connected as {status.email || "your Google account"}</Text> : <Text style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary, marginBottom: 14 }}>Sign in with the Gmail account you want to use. It does not need a separate Ardia browser profile.</Text>}
    {!status?.connected && !status?.clientSecretConfigured && <Text style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary, marginBottom: 14 }}>{status ? "Gmail sign-in is not available in this build yet." : "Checking Gmail sign-in availability…"}</Text>}
    <Checkbox value={allowed} disabled={busy || !status?.connected} onChange={setAllowed} label={`Allow Gmail content in briefs generated with ${provider}`} />
    <Text style={{ fontSize: 11.5, lineHeight: 17, color: theme.textSecondary, marginTop: 10 }}>This sends selected message senders, subjects, dates and snippets to {provider}. Changing providers clears this permission. Revoking permission stops future sharing; content already sent cannot be recalled.</Text>
    {error && <Text style={{ fontSize: 12, lineHeight: 17, color: theme.destructive, marginTop: 12 }}>{error}</Text>}
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
      <Button title={busy && !disconnecting ? "Cancel Sign-In" : "Cancel"} disabled={disconnecting} onPress={closeSettingsSheet} />
      {status?.connected ? <><Button title="Disconnect" disabled={busy} onPress={() => void disconnect()} /><Button title="Save Permission" kind="primary" disabled={busy} onPress={save} /></> : <Button title={busy ? "Waiting for Google…" : "Continue with Google…"} kind="primary" disabled={busy || !status?.clientSecretConfigured} onPress={() => void connect()} />}
    </View>
  </Sheet>;
}

function ClaudeKeySheet({ onSaved }: { onSaved(): void }) {
  const theme = useTheme();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectClaudeKey(key);
      setKey("");
      onSaved();
      closeSettingsSheet();
    } catch (e) {
      setError(String((e as Error)?.message ?? "The API key could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet width={450} onClose={closeSettingsSheet}>
      <Text style={{ fontSize: 17, fontWeight: "600", color: theme.textPrimary, marginBottom: 12 }}>Connect Claude</Text>
      <Text style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary, marginBottom: 14 }}>Create a personal API key scoped to one workspace in Claude Console. It is stored in macOS Keychain. Claude API usage is billed separately from your Claude subscription.</Text>
      <TextField value={key} onChangeText={setKey} secure placeholder="sk-ant-…" onSubmit={() => !busy && key.trim() && void save()} />
      {error ? <Text style={{ fontSize: 12, lineHeight: 17, color: theme.destructive, marginTop: 10 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Button title="Get API Key" onPress={() => void openExternalURL("https://platform.claude.com/settings/keys")} />
        <Button title="Cancel" disabled={busy} onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Save API Key"} kind="primary" disabled={busy || !key.trim()} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}
