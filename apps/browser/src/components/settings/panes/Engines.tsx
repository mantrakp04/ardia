import {
  getPasskeyAccess,
  NO_PASSKEY_ACCESS,
  requestPasskeyAccess,
  type PasskeyAccess,
  type PasskeyAccessStatus,
} from "../../../state/engines/passkeys";
import { type PageEngine, defaultEngine, ENGINE_NAMES, RECOMMENDED_ENGINE, siteOf } from "../../../state/engines/engines";
import { resolveInput } from "@ardia/core";
import { useEffect, useState } from "react";
import { AppState, Linking, Text, View } from "react-native";
import { setWebsiteEngine } from "../../../state/engines/actions";
import { useTheme } from "../../ui/theme";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { Button, font, PopUp, Sheet, TextField, Toggle } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { Group, Row, SectionHeader, SheetActions, SheetTitle } from "../Form";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";

const ENGINE_OPTIONS: { value: PageEngine; title: string }[] = [
  { value: "chromium", title: ENGINE_NAMES.chromium },
  { value: "webkit", title: ENGINE_NAMES.webkit },
];

const siteLabel = (site: string) => site.replace(/^https:\/\//, "");

export function EnginesPane() {
  const engine = useSettings((settings) => defaultEngine({ settings }));
  const rules = useSettings((s) => s.websiteEngines);
  const sites = Object.keys(rules).sort((a, b) => siteLabel(a).localeCompare(siteLabel(b)));
  const protectedVideo = useSettings((s) => s.protectedVideoInWebKit);
  const setDefault = (value: PageEngine) => updateSettings({ pageEngine: value });

  return (
    <View>
      <SectionHeader title="Default engine" />
      <Group>
        <Row anchor="engines.defaultEngine">
          <PopUp value={engine} options={ENGINE_OPTIONS} onChange={setDefault} />
        </Row>
        <Row anchor="engines.recommendedDefault">
          <Button title="Use Recommended" disabled={engine === RECOMMENDED_ENGINE} onPress={() => setDefault(RECOMMENDED_ENGINE)} />
        </Row>
        <Row anchor="engines.protectedVideo">
          <Toggle value={protectedVideo} onChange={(value) => updateSettings({ protectedVideoInWebKit: value })} />
        </Row>
      </Group>

      <SectionHeader anchor="engines.websiteRules" description={null} action={<Button title="Add Website Rule…" icon="plus" onPress={() => showSettingsSheet(<RuleSheet />)} />} />
      <Group of="engines.websiteRules">
        {sites.length === 0 ? (
          <Row title="No website rules" description="Choose “Opens in” in a site's controls, or add a rule here." />
        ) : (
          sites.map((site) => <RuleRow key={site} site={site} engine={rules[site]!} />)
        )}
      </Group>

      <SectionHeader title="How engines differ" />
      <Group>
        <Row anchor="engines.separateData" />
        <Row anchor="engines.chromiumOnly" />
        <PasskeysRow />
      </Group>
    </View>
  );
}

const PASSKEY_STATUS: Record<Exclude<PasskeyAccessStatus, "entitlementRequired">, string> = {
  deviceNotConfigured: "Passkeys aren't set up on this Mac. Set up iCloud Keychain or another passkey app in System Settings, then reopen Ardia.",
  notDetermined: "Allow Ardia to use the passkeys saved on this Mac, from the Passwords app and other passkey apps, in WebKit and Chromium pages.",
  authorized: "Websites can use the passkeys saved on this Mac, in WebKit and Chromium pages.",
  denied: "Off. Turn Ardia on in System Settings › Privacy & Security › Passkeys Access for Web Browsers.",
};

function PasskeysRow() {
  const [access, setAccess] = useState<PasskeyAccess | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => void getPasskeyAccess().catch(() => NO_PASSKEY_ACCESS).then((next) => live && setAccess(next));
    refresh();
    const watch = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      live = false;
      watch.remove();
    };
  }, []);
  if (!access?.entitled) return <Row anchor="engines.passkeys" />;
  const ask = async () => {
    setAsking(true);
    setAccess(await requestPasskeyAccess().catch(() => NO_PASSKEY_ACCESS));
    setAsking(false);
  };
  return (
    <Row anchor="engines.passkeys" description={PASSKEY_STATUS[access.status as keyof typeof PASSKEY_STATUS]}>
      {access.status === "notDetermined" && <Button title="Allow Passkeys…" disabled={asking} onPress={() => void ask()} />}
      {access.status === "denied" && (
        <Button title="Open System Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preference.security")} />
      )}
    </Row>
  );
}

function RuleRow({ site, engine }: { site: string; engine: PageEngine }) {
  return (
    <Row icon={<Favicon url={site} />} title={siteLabel(site)}>
      <PopUp value={engine} options={ENGINE_OPTIONS} onChange={(value) => setWebsiteEngine(site, value)} minWidth={110} />
      <Button variant="icon" icon="pencil" size={11} box={24} radius={6} onPress={() => showSettingsSheet(<RuleSheet site={site} engine={engine} />)} tooltip="Edit" />
      <Button variant="icon" icon="trash" size={11} box={24} radius={6} onPress={() => setWebsiteEngine(site, null)} tooltip="Remove" />
    </Row>
  );
}

function RuleSheet({ site, engine: initial }: { site?: string; engine?: PageEngine }) {
  const theme = useTheme();
  const [address, setAddress] = useState(site ? siteLabel(site) : "");
  const [engine, setEngine] = useState<PageEngine>(initial ?? "webkit");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const typed = address.trim();
    const target = siteOf(/^[a-z][\w+.-]*:\/\//i.test(typed) ? typed : resolveInput(typed, ""));
    if (!target) return setError("Enter a website address, like netflix.com.");
    if (site && site !== target) setWebsiteEngine(site, null);
    setWebsiteEngine(target, engine);
    closeSettingsSheet();
  };
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <SheetTitle>{site ? "Edit Website Rule" : "Add Website Rule"}</SheetTitle>
      <Text style={{ ...font.small, marginTop: 6, color: theme.textSecondary }}>
        A rule matches the site's address exactly: its scheme, host and port. Subdomains need their own rule.
      </Text>
      <View style={{ marginTop: 12 }}>
        <Text style={{ ...font.footnote, marginBottom: 5, color: theme.textSecondary }}>Website</Text>
        <TextField value={address} onChangeText={setAddress} placeholder="netflix.com" onSubmit={save} onEscape={closeSettingsSheet} />
      </View>
      <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ ...font.footnote, color: theme.textSecondary }}>Opens in</Text>
        <PopUp value={engine} options={ENGINE_OPTIONS} onChange={setEngine} />
      </View>
      {error && <Text style={{ ...font.small, marginTop: 10, color: theme.destructive }}>{error}</Text>}
      <SheetActions
        destructive={
          site ? (
            <Button
              title="Remove"
              kind="destructive"
              onPress={() => {
                setWebsiteEngine(site, null);
                closeSettingsSheet();
              }}
            />
          ) : null
        }
      >
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={site ? "Save" : "Add"} kind="primary" onPress={save} />
      </SheetActions>
    </Sheet>
  );
}
