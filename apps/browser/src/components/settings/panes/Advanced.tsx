import { useState } from "react";
import { Text, View } from "react-native";
import { systemInfo } from "../../../state/app/system";
import { describeCliInstall, installCliInBackground, useCli } from "../../../state/app/cliControl";
import { openUrls } from "../../../state/browser/actions";
import { useTheme } from "../../ui/theme";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { openInternalPage } from "../../../state/pages/urls";
import type { BatterySaverWhen } from "../../../state/settings/settings";
import { keepSiteActive, stopKeepingSiteActive, type MemorySaverMode } from "../../../state/tabs/memorySaver";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { Button, font, PopUp, Sheet, TextField, Toggle } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { Group, Row, SectionHeader, SettingToggle, SheetActions, SheetTitle } from "../Form";
import { engineVersion, widevine as widevineComponent } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";

const REPOSITORY = "https://github.com/mantrakp04/ardia";
const SOURCE_NOTICE = "Ardia is free software under the GNU General Public License v3, with no warranty.";

const BATTERY_SAVER_DESCRIPTIONS: Record<BatterySaverWhen, string> = {
  lowBattery: "At 20% battery or less, or in Low Power Mode, busy background tabs pause and animations slow down.",
  unplugged: "On battery or in Low Power Mode, busy background tabs pause and animations slow down.",
  never: "Background tabs and animations run at full speed on battery.",
};

const MEMORY_SAVER_MODES: Record<MemorySaverMode, { title: string; description: string }> = {
  moderate: { title: "Moderate", description: "Get moderate memory savings. Your tabs become inactive after a longer period of time." },
  balanced: { title: "Balanced (recommended)", description: "Get balanced memory savings. Your tabs become inactive after an optimal period of time." },
  maximum: { title: "Maximum", description: "Get maximum memory savings. Your tabs become inactive after a shorter period of time." },
};
const MEMORY_SAVER_OPTIONS = Object.entries(MEMORY_SAVER_MODES).map(([value, { title }]) => ({ value: value as MemorySaverMode, title }));

export function AdvancedPane() {
  const theme = useTheme();
  const hideBookmarksBarImport = useSettings((s) => s.hideBookmarksBarImport);
  const memorySaverMode = useSettings((s) => s.memorySaverMode);
  const batterySaverWhen = useSettings((s) => s.batterySaverWhen);
  const keepActiveSites = useSettings((s) => s.keepActiveSites);
  const warnBeforeMovingTabs = useSettings((s) => s.warnBeforeMovingTabsToProfile);
  const [info] = useResource(engineVersion);
  const [widevine] = useResource(widevineComponent);
  const widevineVersion = widevine && widevine.version !== "0.0.0.0" ? widevine.version : null;

  return (
    <View>
      <SectionHeader title="Browsing" />
      <Group>
        <SettingToggle anchor="advanced.showFullUrl" />
        <Row anchor="advanced.warnMovingTabs">
          <Toggle value={warnBeforeMovingTabs} onChange={(v) => updateSettings({ warnBeforeMovingTabsToProfile: v })} />
        </Row>
        <Row anchor="advanced.bookmarksImport">
          <Toggle value={!hideBookmarksBarImport} onChange={(v) => updateSettings({ hideBookmarksBarImport: !v })} />
        </Row>
      </Group>

      <SectionHeader title="Performance" />
      <Group>
        <SettingToggle anchor="advanced.memorySaver" />
        <Row anchor="advanced.memorySaverMode" description={MEMORY_SAVER_MODES[memorySaverMode].description}>
          <PopUp
            value={memorySaverMode}
            options={MEMORY_SAVER_OPTIONS}
            onChange={(v) => updateSettings({ memorySaverMode: v })}
            minWidth={190}
          />
        </Row>
        <Row anchor="advanced.batterySaver" description={BATTERY_SAVER_DESCRIPTIONS[batterySaverWhen]}>
          <PopUp
            value={batterySaverWhen}
            options={[
              { value: "lowBattery", title: "When battery is low" },
              { value: "unplugged", title: "When unplugged" },
              { value: "never", title: "Never" },
            ]}
            onChange={(v) => updateSettings({ batterySaverWhen: v })}
            minWidth={190}
          />
        </Row>
      </Group>

      <KeepActiveSites sites={keepActiveSites} />

      <SectionHeader title="Data" />
      <Group>
        <Row anchor="advanced.history">
          <Button title="Show History" onPress={() => openInternalPage("history")} />
        </Row>
        <Row anchor="advanced.downloads">
          <Button title="Show Downloads" onPress={() => openInternalPage("downloads")} />
        </Row>
      </Group>

      <CommandLineSection />

      <SectionHeader title="Web engine" />
      <Group>
        <Row anchor="advanced.chromium" description={info ? "ArdiaCore" : undefined}>
          <Text selectable style={{ ...font.body, color: theme.textSecondary }}>
            {info?.chromiumVersion ?? "…"}
          </Text>
        </Row>
        <Row
          anchor="advanced.widevine"
          description={
            widevine === undefined
              ? "Checking…"
              : widevineVersion
                ? `Version ${widevineVersion}`
                : "Not available in this build: video that needs it, like Netflix or Disney+, won't play."
          }
        />
      </Group>

      <SectionHeader title="Source and licenses" />
      <Group>
        <Row anchor="advanced.source" description={SOURCE_NOTICE}>
          <Button title="Show on GitHub" onPress={() => openUrls([`${REPOSITORY}/tree/v${systemInfo().appVersion}`])} />
        </Row>
        <Row anchor="advanced.licenses">
          <Button title="Show Licenses" onPress={() => openUrls(["chrome://credits"])} />
        </Row>
      </Group>
    </View>
  );
}

function CommandLineSection() {
  const theme = useTheme();
  const on = useSettings((s) => s.cliControl);
  const cli = useCli();
  const server = cli.server;
  const serverNote =
    server?.state === "external"
      ? "This instance already has a DevTools port from the command line, so the setting leaves it alone."
      : server?.reason
        ? server.reason
        : on && server?.state === "on"
          ? server.connections
            ? `Connected now: ${server.connections === 1 ? "1 session" : `${server.connections} sessions`}.`
            : "On. Nothing is connected."
          : "While it's on, the command can open, read and act in every page you're signed in to, and it stays on after you quit.";
  return (
    <>
      <SectionHeader title="Command line" />
      <Group>
        <SettingToggle anchor="advanced.cliControl" description={serverNote} />
        <Row
          anchor="advanced.cliInstall"
          description={
            <Text selectable style={{ ...font.footnote, marginTop: 2, lineHeight: 15, color: cli.error && !cli.installing ? theme.destructive : theme.textSecondary }}>
              {describeCliInstall(cli)}
            </Text>
          }
        >
          <Button
            title={cli.installing ? "Installing…" : cli.installedVersion ? "Reinstall" : "Install"}
            disabled={!!cli.installing}
            onPress={() => void installCliInBackground("settings")}
          />
        </Row>
      </Group>
    </>
  );
}

const siteUrl = (site: string) => (/^[a-z][\w+.-]*:\/\//i.test(site) ? site : `https://${site.replace(/^\[\*\.\]|^\*\.|^\./, "")}`);

function KeepActiveSites({ sites }: { sites: string[] }) {
  return (
    <>
      <SectionHeader anchor="advanced.keepActiveSites" description={null} action={<Button title="Add Site…" icon="plus" onPress={() => showSettingsSheet(<KeepActiveSiteSheet />)} />} />
      <Group of="advanced.keepActiveSites">
        {sites.length === 0 ? (
          <Row title="No sites added" />
        ) : (
          [...sites]
            .sort((a, b) => a.localeCompare(b))
            .map((site) => (
              <Row key={site} icon={<Favicon url={siteUrl(site)} />} title={site}>
                <Button variant="icon" icon="trash" size={11} box={24} radius={6} onPress={() => stopKeepingSiteActive(site)} tooltip="Remove" />
              </Row>
            ))
        )}
      </Group>
    </>
  );
}

function KeepActiveSiteSheet() {
  const theme = useTheme();
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const add = async () => {
    setSaving(true);
    const problem = await keepSiteActive(site);
    setSaving(false);
    if (problem) return setError(problem);
    closeSettingsSheet();
  };
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <SheetTitle>Add Site</SheetTitle>
      <Text style={{ ...font.small, marginTop: 6, color: theme.textSecondary }}>Sites you add will always stay active and memory won't be freed up from them.</Text>
      <View style={{ marginTop: 12 }}>
        <Text style={{ ...font.footnote, marginBottom: 5, color: theme.textSecondary }}>Site</Text>
        <TextField value={site} onChangeText={setSite} placeholder="youtube.com" onSubmit={() => void add()} onEscape={closeSettingsSheet} autoFocus />
      </View>
      {error && <Text style={{ ...font.small, marginTop: 10, color: theme.destructive }}>{error}</Text>}
      <SheetActions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Add" kind="primary" disabled={saving || !site.trim()} onPress={() => void add()} />
      </SheetActions>
    </Sheet>
  );
}
