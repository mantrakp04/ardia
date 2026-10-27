import { setDownloadSettings, type DownloadSettings } from "../../../state/downloads/actions";
import {
  checkForUpdates,
  setAsDefaultBrowser,
  setAutomaticUpdateChecks,
  setAutomaticUpdateDownloads,
  setLaunchAtLogin,
  setUpdateChannel,
  type UpdateChannel,
} from "../../../state/app/appSettings";
import { pickFolder } from "../../../state/app/system";
import { Symbol, Button, font, PopUp, Toggle } from "../../ui";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { updateSettings } from "../../../state/settings/actions";
import { currentSettings } from "../../../state/browser/current";
import { useProfiles, useSettings } from "../../../state/browser/hooks";
import { engineProfile } from "../../../state/browser/model";
import { SHARING_COPY } from "../../../state/telemetry/copy";
import { Anchor, Group, Row, SectionHeader } from "../Form";
import { defaultBrowser, downloadSettings, loginItem, updater } from "../../../state/settings/paneData";
import { store, useResource } from "../../../state/settings/resources";
import { openImport } from "../../../state/settings/settingsWindows";
import { SetupCodeRow } from "./SetupCodeRow";

const APP = "Ardia";

export function GeneralPane() {
  const settings = useSettings((s) => s);
  const update = updateSettings;
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

      <DownloadsSection />

      <UpdatesSection />

      <SectionHeader title="Import" />
      <Group>
        <Row anchor="general.importBrowser">
          <Button title="Import…" onPress={openImport} />
        </Row>
        <SetupCodeRow />
      </Group>
    </View>
  );
}

const homeRelative = (path: string) => path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");

function DownloadsSection() {
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(() => currentSettings().defaultProfileId);
  const profile = engineProfile(profileId);
  const [current] = useResource(downloadSettings, profile);
  const others = [...new Set(profiles.map((p) => engineProfile(p.id)))].filter((p) => p !== profile);
  const apply = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, targets = [profile]) =>
    void Promise.all(targets.map((p) => setDownloadSettings(patch, p).then((next) => store(downloadSettings, [p], next), () => {})));
  const change = async () => {
    if (!current) return;
    const folder = await pickFolder(current.folder, "Use Folder");
    if (folder) apply({ folder });
  };

  return (
    <>
      <SectionHeader
        title="Downloads"
        description={profiles.length > 1 ? "Each profile saves to its own folder." : undefined}
        action={
          profiles.length > 1 ? (
            <PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
          ) : undefined
        }
      />
      <Group>
        <Row
          anchor="general.downloadsFolder"
          description={current ? (current.managed ? `${homeRelative(current.folder)}, set by your organization.` : homeRelative(current.folder)) : undefined}
        >
          <Button title="Change…" disabled={!current || current.managed} onPress={() => void change()} />
        </Row>
        <Row anchor="general.askWhereToSave">
          <Toggle value={current?.askWhereToSave ?? false} disabled={!current || current.managed} onChange={(v) => apply({ askWhereToSave: v })} />
        </Row>
        {others.length > 0 && (
          <Row anchor="general.downloadsAllProfiles">
            <Button
              title="Use for All Profiles"
              disabled={!current || current.managed}
              onPress={() => current && apply({ folder: current.folder, askWhereToSave: current.askWhereToSave }, others)}
            />
          </Row>
        )}
      </Group>
    </>
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
        backgroundColor: theme.groupFill,
        borderWidth: 1,
        borderColor: theme.groupBorder,
      }}
    >
      <Symbol
        name={isDefault ? "checkmark.seal.fill" : "safari"}
        size={20}
        color={isDefault ? theme.success : theme.icon}
        style={{ width: 28, height: 28 }}
      />
      <Text style={{ flex: 1, ...font.body, color: theme.textPrimary }}>
        {isDefault ? `${APP} is your default browser` : `${APP} works best as your default browser`}
      </Text>
      {!isDefault && <Button title={`Set ${APP} as Default`} kind="primary" onPress={() => void setAsDefaultBrowser().then((v) => store(defaultBrowser, [], v))} />}
    </Anchor>
  );
}
