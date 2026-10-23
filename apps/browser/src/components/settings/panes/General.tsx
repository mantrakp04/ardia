import {
  checkForUpdates,
  setAsDefaultBrowser,
  setAutomaticUpdateChecks,
  setAutomaticUpdateDownloads,
  setLaunchAtLogin,
  setUpdateChannel,
  Symbol,
  type UpdateChannel,
} from "@ardia/shell";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { linkRuleTarget } from "../../../store/linkRules";
import { newId } from "../../../store/model";
import type { LinkRule } from "../../../store/settings";
import { lastActiveProfile } from "../../../store/small";
import { SHARING_COPY } from "../../../telemetry/copy";
import { Anchor, Button, Group, PopUp, Row, SectionHeader, TextField, Toggle, useFormColors } from "../controls";
import { defaultBrowser, loginItem, updater } from "../paneData";
import { store, useResource } from "../resources";
import { openImport } from "../windows";

const APP = "Ardia";

export function GeneralPane() {
  const settings = useBrowser((s) => s.settings);
  const update = useBrowser((s) => s.updateSettings);
  const [loginStatus = "notRegistered", refreshLogin] = useResource(loginItem);

  return (
    <View>
      <DefaultBrowserBanner />

      <SectionHeader title="General" />
      <Group>
        <Row
          anchor="general.openAtLogin"
          description={loginStatus === "requiresApproval" ? "Allow it in System Settings › General › Login Items." : undefined}
        >
          <Toggle
            value={loginStatus === "enabled" || loginStatus === "requiresApproval"}
            onChange={(on) => void setLaunchAtLogin(on).catch(() => {}).finally(refreshLogin)}
          />
        </Row>
        <Row anchor="general.warnBeforeQuitting">
          <Toggle value={settings.warnBeforeQuitting} onChange={(v) => update({ warnBeforeQuitting: v })} />
        </Row>
        <Row anchor="general.warnBeforeClosingWindow">
          <Toggle value={settings.warnBeforeClosingWindow} onChange={(v) => update({ warnBeforeClosingWindow: v })} />
        </Row>
        <Row
          anchor="general.openLinksFrom"
          description={
            settings.openLinksInLittleArdia
              ? `A link from Discord, Slack or Mail opens in Little Ardia, a small window of its own. ⌘O moves it into ${APP}; closing it throws it away.`
              : `A link from Discord, Slack or Mail opens as a new tab in the ${APP} window you used last.`
          }
        >
          <PopUp
            value={settings.openLinksInLittleArdia ? "small" : "tab"}
            options={[
              { value: "small", title: "Little Ardia" },
              { value: "tab", title: "A new tab" },
            ]}
            onChange={(v) => update({ openLinksInLittleArdia: v === "small" })}
            minWidth={190}
          />
        </Row>
      </Group>

      <LinkRulesSection />

      <SectionHeader title={`When quitting ${APP}:`} />
      <Group>
        <Row anchor="general.windowsAndTabs">
          <PopUp
            value={settings.restoreSession ? "keep" : "close"}
            options={[
              { value: "keep", title: "Preserve tabs and windows" },
              { value: "close", title: "Start fresh" },
            ]}
            onChange={(v) => update({ restoreSession: v === "keep" })}
            minWidth={190}
          />
        </Row>
      </Group>

      <SectionHeader title="Command bar" description="What happens when what you type could be a website or a search." />
      <Group>
        <Row anchor="general.commandBarPreference">
          <PopUp
            value={settings.commandBarPreference}
            options={[
              { value: "website", title: "Use Website First" },
              { value: "search", title: "Prefer Search Engine" },
            ]}
            onChange={(v) => update({ commandBarPreference: v })}
            minWidth={190}
          />
        </Row>
      </Group>

      <UpdatesSection />

      <SectionHeader title="Import" />
      <Group>
        <Row anchor="general.importBrowser">
          <Button title="Import…" onPress={openImport} />
        </Row>
      </Group>
    </View>
  );
}

function editLinkRules(edit: (rules: LinkRule[]) => LinkRule[]) {
  const s = useBrowser.getState();
  s.updateSettings({ linkRules: edit(s.settings.linkRules) });
}

function LinkRulesSection() {
  const rules = useBrowser((s) => s.settings.linkRules);
  const [added, setAdded] = useState<string | null>(null);
  const add = () => {
    const rule = { id: newId("linkRule"), pattern: "", profileId: lastActiveProfile(useBrowser.getState()) };
    editLinkRules((all) => [...all, rule]);
    setAdded(rule.id);
  };
  return (
    <>
      <SectionHeader
        anchor="general.linkRules"
        description="A link from another app to a site in this list opens in that site's profile. The first match wins."
        action={<Button title="Add Rule" icon="plus" onPress={add} />}
      />
      {rules.length > 0 && <Group>{rules.map((rule) => <LinkRuleRow key={rule.id} rule={rule} autoFocus={rule.id === added} />)}</Group>}
    </>
  );
}

function LinkRuleRow({ rule, autoFocus }: { rule: LinkRule; autoFocus: boolean }) {
  const profiles = useProfiles();
  const [pattern, setPattern] = useState(rule.pattern);
  const change = (patch: Partial<LinkRule>) => editLinkRules((all) => all.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
  const remove = () => editLinkRules((all) => all.filter((r) => r.id !== rule.id));
  const commit = () => {
    if (pattern.trim() !== rule.pattern) change({ pattern: pattern.trim() });
  };
  const invalid = !!pattern.trim() && !linkRuleTarget(pattern);
  return (
    <Row
      title={
        <TextField
          value={pattern}
          onChangeText={setPattern}
          placeholder="github.com/acme"
          autoFocus={autoFocus}
          onSubmit={commit}
          onBlur={commit}
          onEscape={() => setPattern(rule.pattern)}
        />
      }
      description={invalid ? "Type a site, like github.com, or a site and a path, like github.com/acme." : undefined}
    >
      <PopUp value={rule.profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={(profileId) => change({ profileId })} minWidth={160} />
      <Button title="Remove" kind="plain" onPress={remove} />
    </Row>
  );
}

function UpdatesSection() {
  const [state, reload] = useResource(updater);
  const refresh = () => void reload();
  useEffect(() => {
    const sub = AppState.addEventListener("change", refresh);
    return () => sub.remove();
  }, []);
  if (!state?.available) return null;
  const ready = state.configured;
  const set = (patch: { automaticChecks?: boolean; automaticDownloads?: boolean; channel?: UpdateChannel }) => {
    store(updater, [], { ...state, ...patch });
    if (patch.automaticChecks !== undefined) void setAutomaticUpdateChecks(patch.automaticChecks).finally(refresh);
    if (patch.automaticDownloads !== undefined) void setAutomaticUpdateDownloads(patch.automaticDownloads).finally(refresh);
    if (patch.channel !== undefined) void setUpdateChannel(patch.channel).finally(refresh);
  };
  const lastCheck = state.lastCheck
    ? `Last checked ${new Date(state.lastCheck).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
    : "Not checked yet.";
  return (
    <>
      <SectionHeader title="Updates" description={ready ? undefined : "Updates aren't set up for this build."} />
      <Group>
        <Row anchor="general.updateChecks" description={`${SHARING_COPY.updateChecks} ${SHARING_COPY.switchFile}`}>
          <Toggle value={ready && state.automaticChecks} disabled={!ready} onChange={(v) => set({ automaticChecks: v })} />
        </Row>
        <Row anchor="general.autoUpdate">
          <Toggle
            value={ready && state.automaticChecks && state.automaticDownloads}
            disabled={!ready || !state.automaticChecks}
            onChange={(v) => set({ automaticDownloads: v })}
          />
        </Row>
        {state.channel && (
          <Row anchor="general.updateChannel">
            <PopUp
              value={state.channel}
              options={[
                { value: "stable", title: "Stable" },
                { value: "nightly", title: "Nightly" },
              ]}
              disabled={!ready}
              onChange={(channel) => set({ channel })}
              minWidth={190}
            />
          </Row>
        )}
        <Row anchor="general.checkNow" title={`${APP} ${state.displayVersion ?? state.version}`} description={ready ? lastCheck : undefined}>
          <Button title="Check Now" disabled={ready && (!state.canCheck || state.sessionInProgress)} onPress={() => void checkForUpdates().finally(refresh)} />
        </Row>
      </Group>
    </>
  );
}

function DefaultBrowserBanner() {
  const theme = useTheme();
  const colors = useFormColors();
  const [isDefault, reload] = useResource(defaultBrowser);
  useEffect(() => {
    const sub = AppState.addEventListener("change", () => void reload());
    return () => sub.remove();
  }, []);
  return (
    <Anchor
      id="general.defaultBrowser"
      radius={12}
      style={{
        marginTop: 20,
        padding: 14,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: colors.group,
        borderWidth: 1,
        borderColor: colors.groupBorder,
      }}
    >
      <Symbol
        name={isDefault ? "checkmark.seal.fill" : "safari"}
        size={20}
        color={isDefault ? "#34C759" : theme.icon}
        style={{ width: 28, height: 28 }}
      />
      <Text style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>
        {isDefault ? `${APP} is your default browser` : `${APP} works best as your default browser`}
      </Text>
      {!isDefault && <Button title={`Set ${APP} as Default`} kind="primary" onPress={() => void setAsDefaultBrowser().then((v) => store(defaultBrowser, [], v))} />}
    </Anchor>
  );
}
