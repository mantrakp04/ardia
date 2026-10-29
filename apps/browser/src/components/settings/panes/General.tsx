import type { DownloadSettings } from "../../../state/downloads/actions";
import { checkForUpdates, setLaunchAtLogin } from "../../../state/app/appSettings";
import { pickFolder } from "../../../state/app/system";
import { Symbol, Button, font, PopUp, Toggle } from "../../ui";
import { useEffect } from "react";
import { AppState, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { updateSettings } from "../../../state/settings/actions";
import { currentEngineProfile } from "../../../state/browser/current";
import { useProfiles, useSettings } from "../../../state/browser/hooks";
import { SHARING_COPY } from "../../../state/telemetry/copy";
import { Anchor, Group, ProfilePicker, Row, SectionHeader, SettingToggle, useSettingsProfile } from "../Form";
import { defaultBrowser, downloadSettings, loginItem, makeDefaultBrowser, setDownloadsFor, setUpdaterPrefs, updater } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { openImport } from "../../../state/settings/settingsWindows";
import { ExportBookmarksRow } from "./ExportBookmarksRow";
import { SetupCodeRow } from "./SetupCodeRow";
import { UI_LOCALE } from "../../../lib/uiLocale";

const APP = "Ardia";

export function GeneralPane() {
  const openLinksInLittleArdia = useSettings((s) => s.openLinksInLittleArdia);
  const restoreSession = useSettings((s) => s.restoreSession);
  const commandBarPreference = useSettings((s) => s.commandBarPreference);
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
        <SettingToggle anchor="general.warnBeforeQuitting" />
        <SettingToggle anchor="general.warnBeforeClosingWindow" />
        <Row
          anchor="general.openLinksFrom"
          description={
            openLinksInLittleArdia
              ? `A link from Discord, Slack or Mail opens in Little Ardia, a small window of its own. ⌘O moves it into ${APP}; closing it throws it away.`
              : `A link from Discord, Slack or Mail opens as a new tab in the ${APP} window you used last.`
          }
        >
          <PopUp
            value={openLinksInLittleArdia ? "small" : "tab"}
            options={[
              { value: "small", title: "Little Ardia" },
              { value: "tab", title: "A new tab" },
            ]}
            onChange={(v) => updateSettings({ openLinksInLittleArdia: v === "small" })}
            minWidth={190}
          />
        </Row>
      </Group>

      <SectionHeader title={`When quitting ${APP}:`} />
      <Group>
        <Row anchor="general.windowsAndTabs">
          <PopUp
            value={restoreSession ? "keep" : "close"}
            options={[
              { value: "keep", title: "Preserve tabs and windows" },
              { value: "close", title: "Start fresh" },
            ]}
            onChange={(v) => updateSettings({ restoreSession: v === "keep" })}
            minWidth={190}
          />
        </Row>
      </Group>

      <SectionHeader title="Command bar" description="What happens when what you type could be a website or a search." />
      <Group>
        <Row anchor="general.commandBarPreference">
          <PopUp
            value={commandBarPreference}
            options={[
              { value: "website", title: "Use Website First" },
              { value: "search", title: "Prefer Search Engine" },
            ]}
            onChange={(v) => updateSettings({ commandBarPreference: v })}
            minWidth={190}
          />
        </Row>
      </Group>

      <DownloadsSection />

      <UpdatesSection />

      <SectionHeader title="Import and Export" />
      <Group>
        <Row anchor="general.importBrowser">
          <Button title="Import…" onPress={openImport} />
        </Row>
        <ExportBookmarksRow />
        <SetupCodeRow />
      </Group>
    </View>
  );
}

const homeRelative = (path: string) => path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");

function DownloadsSection() {
  const profiles = useProfiles();
  const [profileId, setProfileId] = useSettingsProfile();
  const profile = currentEngineProfile(profileId);
  const [current] = useResource(downloadSettings, profile);
  const others = [...new Set(profiles.map((p) => currentEngineProfile(p.id)))].filter((p) => p !== profile);
  const apply = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, targets = [profile]) => void setDownloadsFor(patch, targets);
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
        action={<ProfilePicker value={profileId} onChange={setProfileId} />}
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
  const lastCheck = state.lastCheck
    ? `Last checked ${new Date(state.lastCheck).toLocaleString(UI_LOCALE, { dateStyle: "medium", timeStyle: "short" })}.`
    : "Not checked yet.";
  return (
    <>
      <SectionHeader title="Updates" description={ready ? undefined : "Updates aren't set up for this build."} />
      <Group>
        <Row anchor="general.updateChecks" description={`${SHARING_COPY.updateChecks} ${SHARING_COPY.switchFile}`}>
          <Toggle value={ready && state.automaticChecks} disabled={!ready} onChange={(v) => setUpdaterPrefs({ automaticChecks: v })} />
        </Row>
        <Row anchor="general.autoUpdate">
          <Toggle
            value={ready && state.automaticChecks && state.automaticDownloads}
            disabled={!ready || !state.automaticChecks}
            onChange={(v) => setUpdaterPrefs({ automaticDownloads: v })}
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
              onChange={(channel) => setUpdaterPrefs({ channel })}
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
      {!isDefault && <Button title={`Set ${APP} as Default`} kind="primary" onPress={() => void makeDefaultBrowser()} />}
    </Anchor>
  );
}
