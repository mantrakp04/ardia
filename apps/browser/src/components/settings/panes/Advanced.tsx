import { Text, View } from "react-native";
import { systemInfo } from "@ardia/shell";
import { describeCliInstall, installCliInBackground, useCli } from "../../../lib/cliControl";
import { openUrls } from "../../../lib/actions";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { openInternalPage } from "../../pages/urls";
import type { BatterySaverWhen } from "../../../store/settings";
import { Button, Group, PopUp, Row, SectionHeader, Toggle, useFormColors } from "../controls";
import { engineVersion, widevine as widevineComponent } from "../paneData";
import { useResource } from "../resources";

const SOURCE_NOTICE = "Ardia is free software under the GNU General Public License v3, with no warranty.";

const BATTERY_SAVER_DESCRIPTIONS: Record<BatterySaverWhen, string> = {
  lowBattery: "At 20% battery or less, or in Low Power Mode, busy background tabs pause and animations slow down.",
  unplugged: "On battery or in Low Power Mode, busy background tabs pause and animations slow down.",
  never: "Background tabs and animations run at full speed on battery.",
};

export function AdvancedPane() {
  const theme = useTheme();
  const settings = useBrowser((s) => s.settings);
  const update = useBrowser((s) => s.updateSettings);
  const [info] = useResource(engineVersion);
  const [widevine] = useResource(widevineComponent);
  const widevineVersion = widevine && widevine.version !== "0.0.0.0" ? widevine.version : null;

  return (
    <View>
      <SectionHeader title="Browsing" />
      <Group>
        <Row anchor="advanced.showFullUrl">
          <Toggle value={settings.showFullUrl} onChange={(v) => update({ showFullUrl: v })} />
        </Row>
        <Row anchor="advanced.warnMovingTabs">
          <Toggle value={settings.warnBeforeMovingTabsToProfile} onChange={(v) => update({ warnBeforeMovingTabsToProfile: v })} />
        </Row>
        <Row anchor="advanced.bookmarksImport">
          <Toggle value={!settings.hideBookmarksBarImport} onChange={(v) => update({ hideBookmarksBarImport: !v })} />
        </Row>
      </Group>

      <SectionHeader title="Performance" />
      <Group>
        <Row anchor="advanced.batterySaver" description={BATTERY_SAVER_DESCRIPTIONS[settings.batterySaverWhen]}>
          <PopUp
            value={settings.batterySaverWhen}
            options={[
              { value: "lowBattery", title: "When battery is low" },
              { value: "unplugged", title: "When unplugged" },
              { value: "never", title: "Never" },
            ]}
            onChange={(v) => update({ batterySaverWhen: v })}
            minWidth={190}
          />
        </Row>
      </Group>

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
          <Text selectable style={{ fontSize: 13, color: theme.textSecondary }}>
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
        {systemInfo().releaseRepo ? (
          <Row anchor="advanced.source" description={SOURCE_NOTICE}>
            <Button
              title="Show on GitHub"
              onPress={() => openUrls([`https://github.com/${systemInfo().releaseRepo}/tree/v${systemInfo().appVersion}`])}
            />
          </Row>
        ) : null}
        <Row anchor="advanced.licenses">
          <Button title="Show Licenses" onPress={() => openUrls(["chrome://credits"])} />
        </Row>
      </Group>
    </View>
  );
}

function CommandLineSection() {
  const theme = useTheme();
  const colors = useFormColors();
  const on = useBrowser((s) => s.settings.cliControl ?? false);
  const update = useBrowser((s) => s.updateSettings);
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
        <Row anchor="advanced.cliControl" description={serverNote}>
          <Toggle value={on} onChange={(v) => update({ cliControl: v })} />
        </Row>
        <Row
          anchor="advanced.cliInstall"
          description={
            <Text selectable style={{ fontSize: 11.5, marginTop: 2, lineHeight: 15, color: cli.error && !cli.installing ? colors.destructive : theme.textSecondary }}>
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
