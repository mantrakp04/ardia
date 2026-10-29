import {
  clearSiteData,
  getSiteSettings,
  onContentBlockerChange,
  removeExternalAppAllowance,
  resetSiteSettings,
  setContentBlockerAllowed,
  setSiteSetting,
  setZoom,
  type ClearSiteDataResult,
  type FilterList,
  type FilterListCategory,
  type SiteSettings,
  type SiteSettingType,
  type SiteSettingValue,
} from "../../../state/site/siteSettings";
import { confirm } from "../../../state/app/system";
import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { currentEngineProfile } from "../../../state/browser/current";
import { useSettings } from "../../../state/browser/hooks";
import { Button, Checkbox, font, PopUp, Sheet, Toggle } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { Group, ProfilePicker, Row, SectionHeader, SheetTitle, useSettingsProfile } from "../Form";
import { setting, type SettingId } from "../settingsIndex";
import { appLinks, contentBlocker, siteOrigins, zoomLevels } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { updateSettings } from "../../../state/settings/actions";
import { categoryOn, setBlockingCategory, setFilterList } from "../../../state/site/contentBlocking";
import { ShareDiagnosticsSection } from "./ShareDiagnostics";
import { UI_LOCALE } from "../../../lib/uiLocale";

const CATEGORIES: { id: FilterListCategory; section: string; anchor?: SettingId }[] = [
  { id: "ads", section: "Ad blockers", anchor: "privacy.blockAds" },
  { id: "trackers", section: "Trackers", anchor: "privacy.blockTrackers" },
  { id: "cookies", section: "Cookie banners", anchor: "privacy.blockCookieBanners" },
  { id: "annoyances", section: "Annoyances" },
  { id: "security", section: "Malware and scams" },
  { id: "regional", section: "Regional blockers" },
];

const filtersText = (n: number) => `${n.toLocaleString(UI_LOCALE)} ${n === 1 ? "filter" : "filters"}`;

function useContentBlocker() {
  const [state, reload] = useResource(contentBlocker);
  const refresh = () => void reload();
  useEffect(() => {
    const sub = onContentBlockerChange(refresh);
    return () => sub.remove();
  }, []);
  return [state ?? null, refresh] as const;
}

export function PrivacyPane() {
  const theme = useTheme();
  const [blocker, refresh] = useContentBlocker();
  const commandScrollZoom = useSettings((s) => s.commandScrollZoom);

  const toggleCategory = async (c: FilterListCategory, on: boolean) => {
    if (!blocker) return;
    if (!on && c === "ads") {
      const { confirmed } = await confirm({
        title: "Turn Off Ad Blocker?",
        message: "Ardia's Ad Blocker hides ads so pages load faster and feel cleaner.",
        confirmTitle: "Turn Off",
      });
      if (!confirmed) return refresh();
    }
    try {
      await setBlockingCategory(blocker, c, on);
    } finally {
      refresh();
    }
  };

  return (
    <View>
      <SectionHeader title="Content blocking" description="Built on EasyList and EasyPrivacy. Blocking happens on this Mac." />
      <Group>
        {CATEGORIES.filter((c) => c.anchor).map((c) => (
          <Row key={c.id} anchor={c.anchor}>
            <Toggle value={!!blocker && categoryOn(blocker, c.id)} disabled={!blocker} onChange={(v) => void toggleCategory(c.id, v)} />
          </Row>
        ))}
        <Row anchor="privacy.filterLists">
          <Button title="Advanced…" disabled={!blocker} onPress={() => showSettingsSheet(<FilterListsSheet />)} />
        </Row>
      </Group>

      {!!blocker?.allowedHosts.length && (
        <>
          <SectionHeader title="Sites without blocking" description="Turned off from a site's controls. Blocking applies to subdomains too." />
          <Group>
            {blocker.allowedHosts.map((host) => (
              <Row key={host} icon={<Favicon url={`https://${host}`} />} title={host}>
                <Button
                  title="Block Again"
                  onPress={() => void setContentBlockerAllowed(host, false).then(refresh)}
                />
              </Row>
            ))}
          </Group>
        </>
      )}

      <SitePermissions />
      <AppLinks />
      <SectionHeader anchor="privacy.commandScrollZoom" description={null} />
      <Group>
        <Row anchor="privacy.commandScrollZoom">
          <Toggle value={commandScrollZoom} onChange={(v) => updateSettings({ commandScrollZoom: v })} />
        </Row>
      </Group>
      <ZoomLevels />
      {blocker && (
        <Text style={{ marginTop: 14, ...font.footnote, color: theme.textTertiary }}>
          {`${(blocker.stats.networkFilters ?? 0).toLocaleString(UI_LOCALE)} network and ${(blocker.stats.cosmeticFilters ?? 0).toLocaleString(UI_LOCALE)} cosmetic rules loaded.`}
        </Text>
      )}
      <ShareDiagnosticsSection />
    </View>
  );
}

function FilterListsSheet() {
  const theme = useTheme();
  const [blocker, refresh] = useContentBlocker();
  const toggle = async (l: FilterList, on: boolean) => {
    if (!blocker) return;
    try {
      await setFilterList(blocker, l.id, on);
    } finally {
      refresh();
    }
  };
  return (
    <Sheet width={500} onClose={closeSettingsSheet}>
      <SheetTitle>Advanced Ad Block Settings</SheetTitle>
      <Text style={{ ...font.small, marginTop: 4, color: theme.textSecondary }}>{setting("privacy.filterLists").description}</Text>
      <ScrollView style={{ maxHeight: 420, marginTop: 8 }}>
        {CATEGORIES.map((c) => {
          const lists = blocker?.lists.filter((l) => l.category === c.id) ?? [];
          if (!lists.length) return null;
          return (
            <View key={c.id}>
              <SectionHeader title={c.section} />
              <Group>
                {lists.map((l) => (
                  <Row
                    key={l.id}
                    title={<Checkbox value={l.enabled} onChange={(v) => void toggle(l, v)} label={l.title} />}
                    description={l.defaultOn ? `${filtersText(l.filters)} · On by default` : filtersText(l.filters)}
                  />
                ))}
              </Group>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Text style={{ flex: 1, ...font.footnote, color: theme.textTertiary }}>
          {blocker?.version ? `Blocking by uBlock Origin ${blocker.version}, included with Ardia. Its lists update on their own.` : ""}
        </Text>
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </View>
    </Sheet>
  );
}

function ZoomLevels() {
  const [selected, setSelected] = useSettingsProfile();
  const [loaded, reload] = useResource(zoomLevels, currentEngineProfile(selected));
  const levels = loaded ?? {};
  const load = () => void reload();
  const hosts = Object.keys(levels).sort();
  if (!hosts.length) return null;
  return (
    <>
      <SectionHeader
        title="Zoom levels"
        action={<ProfilePicker value={selected} onChange={setSelected} />}
      />
      <Group>
        {hosts.map((host) => (
          <Row key={host} icon={<Favicon url={`https://${host}`} />} title={host} description={`${Math.round(levels[host]! * 100)}%`}>
            <Button title="Reset" onPress={() => void setZoom(currentEngineProfile(selected), host, 1).then(load)} />
          </Row>
        ))}
      </Group>
    </>
  );
}

const SETTING_LABELS: [SiteSettingType, string][] = [
  ["popups", "Pop-ups and redirects"],
  ["camera", "Camera"],
  ["microphone", "Microphone"],
  ["location", "Location"],
  ["notifications", "Notifications"],
  ["sound", "Sound"],
  ["autoplay", "Autoplay"],
  ["javascript", "JavaScript"],
  ["images", "Images"],
  ["clipboard", "Clipboard"],
  ["automaticDownloads", "Automatic downloads"],
  ["cookies", "Cookies"],
  ["midi", "MIDI devices"],
  ["windowManagement", "Window management"],
  ["localFonts", "Fonts"],
  ["storageAccess", "Embedded content"],
  ["fileSystem", "File editing"],
];

const VALUE_OPTIONS: { value: SiteSettingValue; title: string }[] = [
  { value: "default", title: "Default" },
  { value: "allow", title: "Allow" },
  { value: "block", title: "Block" },
  { value: "ask", title: "Ask" },
];

function SitePermissions() {
  const [profileId, setProfileId] = useSettingsProfile();
  const [loaded, reload] = useResource(siteOrigins, currentEngineProfile(profileId));
  const origins = loaded ?? null;
  const refresh = () => void reload();

  return (
    <>
      <SectionHeader
        anchor="privacy.sitePermissions"
        action={<ProfilePicker value={profileId} onChange={setProfileId} />}
      />
      <Group>
        {origins === null ? (
          <Row title=" " description=" " />
        ) : origins.length === 0 ? (
          <Row title="No sites yet" description="Sites appear here after you allow or block something for them." />
        ) : (
          origins.map((origin) => (
            <Row
              key={origin}
              icon={<Favicon url={origin} />}
              title={origin.replace(/^https?:\/\//, "")}
              onPress={() => showSettingsSheet(<SiteSheet profileId={profileId} origin={origin} onChanged={refresh} />)}
            />
          ))
        )}
      </Group>
    </>
  );
}

function AppLinks() {
  const [profileId, setProfileId] = useSettingsProfile();
  const [loaded, reload] = useResource(appLinks, currentEngineProfile(profileId));
  const allowed = loaded ?? null;
  const refresh = () => void reload();

  return (
    <>
      <SectionHeader
        anchor="privacy.appLinks"
        action={<ProfilePicker value={profileId} onChange={setProfileId} />}
      />
      <Group of="privacy.appLinks">
        {allowed === null ? (
          <Row title=" " description=" " />
        ) : allowed.length === 0 ? (
          <Row title="No apps yet" description="Check “Always allow” when a site opens an app, and it shows up here." />
        ) : (
          allowed.map((a) => (
            <Row
              key={`${a.origin}|${a.scheme}`}
              icon={a.icon ? <Image source={{ uri: a.icon }} style={{ width: 20, height: 20 }} /> : <Favicon url={a.origin} />}
              title={a.origin.replace(/^https?:\/\//, "")}
              description={`Opens ${a.scheme}: links in ${a.app ?? "an app that's no longer installed"}`}
            >
              <Button
                title="Remove"
                onPress={() => void removeExternalAppAllowance(currentEngineProfile(profileId), a.origin, a.scheme).then(refresh)}
              />
            </Row>
          ))
        )}
      </Group>
    </>
  );
}

function SiteSheet({ profileId, origin, onChanged }: { profileId: string; origin: string; onChanged: () => void }) {
  const theme = useTheme();
  const profile = currentEngineProfile(profileId);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [status, setStatus] = useState("");
  const load = () => void getSiteSettings(profile, origin).catch((): SiteSettings => ({}) as SiteSettings).then(setSettings).catch(() => {});
  useEffect(load, []);
  const set = async (type: SiteSettingType, value: SiteSettingValue) => {
    await setSiteSetting(profile, origin, type, value);
    load();
    onChanged();
  };
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Favicon url={origin} size={20} />
        <SheetTitle style={{ flex: 1 }}>{origin.replace(/^https?:\/\//, "")}</SheetTitle>
      </View>
      <ScrollView style={{ maxHeight: 380, marginTop: 12 }}>
        <Group>
          {SETTING_LABELS.filter(([type]) => settings?.[type]).map(([type, label]) => (
            <Row key={type} title={label} description={settings![type].isDefault ? `Default (${settings![type].value})` : undefined}>
              <PopUp
                value={settings![type].isDefault ? "default" : settings![type].value}
                options={VALUE_OPTIONS}
                onChange={(v) => void set(type, v)}
                minWidth={100}
              />
            </Row>
          ))}
        </Group>
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>
        <Button
          title="Reset Permissions"
          onPress={() =>
            void resetSiteSettings(profile, origin).then(() => {
              load();
              onChanged();
            })
          }
        />
        <Button
          title="Clear Site Data"
          onPress={() =>
            void clearSiteData(profile, origin).catch((): ClearSiteDataResult => ({ cookies: false, storage: false })).then((r) =>
              setStatus(r.cookies === false ? "Site data cleared." : `Cleared ${r.cookies} cookie${r.cookies === 1 ? "" : "s"} and site data.`),
            )
          }
        />
        <Text style={{ flex: 1, ...font.small, color: theme.textSecondary }}>{status}</Text>
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </View>
    </Sheet>
  );
}
