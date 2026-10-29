import {
  reloadExtension,
  addFromWebStore,
  configure,
  extensionsProfileId,
  loadUnpacked,
  openExtensionDetails,
  refreshExtensions,
  removeExtension,
  setEnabled,
  setPinned,
  showExtensionsList,
  useExtensionList,
} from "../../../state/extensions/actions";
import type { InstalledExtension } from "../../../state/extensions/store";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { currentEngineProfile, resolvedWindowId } from "../../../state/browser/current";
import { newTab } from "../../../state/tabs/actions";
import { InstallDialogHost } from "../../extensions/ExtensionOverlays";
import { Button, font, PopUp, TextField, Toggle, weight } from "../../ui";
import { Group, ProfilePicker, Row, SectionHeader } from "../Form";
import { extensionList } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { replaceSettingsPlace, SETTINGS_WINDOW_ID } from "../../../state/settings/settingsWindows";
import { settingsType } from "../tokens";

type SiteAccess = "allSites" | "specificSites" | "onClick";
const SITE_ACCESS: { value: SiteAccess; title: string }[] = [
  { value: "allSites", title: "On all sites" },
  { value: "specificSites", title: "On specific sites" },
  { value: "onClick", title: "On click" },
];
const siteAccessOf = (ext: InstalledExtension): SiteAccess =>
  ext.siteAccess === "ON_CLICK" ? "onClick" : ext.siteAccess === "ON_SPECIFIC_SITES" ? "specificSites" : "allSites";

export function ExtensionsPane({ profileId: chosen, detail }: { profileId: string | null; detail: string | null }) {
  const theme = useTheme();
  const [profileId] = useState(() => extensionsProfileId(chosen));
  const profile = currentEngineProfile(profileId);
  const list = useExtensionList(profile);
  const [link, setLink] = useState("");
  const [loaded] = useResource(extensionList, profile);

  const showInstall = () =>
    showSettingsSheet(<InstallDialogHost windowId={SETTINGS_WINDOW_ID} onClosed={closeSettingsSheet} />);
  const addLink = () => {
    if (!link.trim()) return;
    void addFromWebStore(SETTINGS_WINDOW_ID, link.trim(), profile);
    showInstall();
    setLink("");
  };

  const selected = detail && chosen === profileId ? list.find((x) => x.id === detail) : undefined;
  const gone = !!detail && !selected && loaded !== undefined;
  useEffect(() => {
    if (gone) replaceSettingsPlace(profileId, null);
  }, [gone, profileId]);
  if (selected) return <ExtensionDetails ext={selected} profile={profile} onBack={() => showExtensionsList(profileId)} />;

  return (
    <View>
      <SectionHeader
        anchor="extensions.installed"
        action={<ProfilePicker value={profileId} onChange={(id) => replaceSettingsPlace(id)} />}
      />
      {list.length ? (
        <Group>
          {list.map((ext) => (
            <Row
              key={ext.id}
              icon={<Image source={{ uri: ext.icon }} style={{ width: 24, height: 24, opacity: ext.enabled ? 1 : 0.5 }} />}
              title={
                <Text numberOfLines={1} style={{ ...font.body, color: theme.textPrimary }}>
                  {ext.name}
                  <Text style={{ color: theme.textTertiary }}>{`  ${ext.version}${ext.fromWebStore ? "" : " · Developer"}`}</Text>
                </Text>
              }
              description={ext.errors.length && !ext.enabled ? ext.errors[0] : ext.description}
              onPress={() => openExtensionDetails(profileId, ext.id)}
            >
              <Toggle value={ext.enabled} onChange={(on) => void setEnabled(profile, ext.id, on)} />
            </Row>
          ))}
        </Group>
      ) : (
        <Group>
          <Row title="No extensions yet" description="Extensions you add appear here and in the Extensions menu." />
        </Group>
      )}

      <SectionHeader title="Add extensions" />
      <Group>
        <Row anchor="extensions.webStore">
          <Button
            title="Open Web Store"
            onPress={() => {
              const windowId = resolvedWindowId();
              if (windowId) newTab(windowId, { url: "https://chromewebstore.google.com/category/extensions" });
            }}
          />
        </Row>
        <Row anchor="extensions.addLink">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextField value={link} onChangeText={setLink} placeholder="chromewebstore.google.com/detail/…" onSubmit={addLink} style={{ width: 210 }} />
            <Button title="Add" disabled={!link.trim()} onPress={addLink} />
          </View>
        </Row>
        <Row anchor="extensions.unpacked">
          <Button
            title="Choose Folder…"
            onPress={() => void loadUnpacked(SETTINGS_WINDOW_ID, profile).then((chosen) => chosen && showInstall())}
          />
        </Row>
      </Group>
    </View>
  );
}

function ExtensionDetails({ ext, profile, onBack }: { ext: InstalledExtension; profile: string; onBack: () => void }) {
  const theme = useTheme();
  const openTab = (url: string) => {
    const windowId = resolvedWindowId();
    if (windowId) newTab(windowId, { url });
  };
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 }}>
        <Button title="All Extensions" icon="chevron.left" kind="plain" onPress={onBack} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 }}>
        <Image source={{ uri: ext.icon }} style={{ width: 48, height: 48 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...settingsType.extensionTitle, fontWeight: weight.semibold, color: theme.textPrimary }}>{ext.name}</Text>
          <Text style={{ ...font.small, color: theme.textSecondary, marginTop: 2 }}>
            {`Version ${ext.version}${ext.fromWebStore ? " · Chrome Web Store" : " · Unpacked"}`}
          </Text>
        </View>
        <Toggle value={ext.enabled} onChange={(on) => void setEnabled(profile, ext.id, on)} />
      </View>
      {ext.description ? <Text style={{ ...font.body, color: theme.textSecondary, marginTop: 12, lineHeight: 18 }}>{ext.description}</Text> : null}

      <SectionHeader title="Permissions" />
      <Group>
        {ext.permissions.length ? (
          ext.permissions.map((p) => <Row key={p} title={p} />)
        ) : (
          <Row title="This extension requires no special permissions." />
        )}
        {ext.siteAccess ? (
          <Row title="Site access" description="Which sites the extension can read and change.">
            <PopUp value={siteAccessOf(ext)} options={SITE_ACCESS} onChange={(siteAccess) => void configure(profile, ext.id, { siteAccess })} />
          </Row>
        ) : null}
      </Group>

      <SectionHeader title="Settings" />
      <Group>
        <Row title="Pin to toolbar" description="Show its button next to the address.">
          <Toggle value={ext.pinned} onChange={(pinned) => void setPinned(profile, ext.id, pinned)} />
        </Row>
        <Row title="Allow in Incognito" description="Incognito can't stop extensions from recording your browsing.">
          <Toggle value={ext.incognito} onChange={(incognito) => void configure(profile, ext.id, { incognito })} />
        </Row>
        {ext.userScriptsAvailable ? (
          <Row
            title="Allow User Scripts"
            description="Lets it run code that no one has reviewed, like userscripts in Tampermonkey. Turn on only if you trust what you add."
          >
            <Toggle value={!!ext.userScripts} onChange={(userScripts) => void configure(profile, ext.id, { userScripts })} />
          </Row>
        ) : null}
        {ext.optionsUrl ? (
          <Row title="Extension options">
            <Button title="Open" onPress={() => openTab(ext.optionsUrl!)} />
          </Row>
        ) : null}
        {ext.webStoreUrl ? (
          <Row title="View in Chrome Web Store">
            <Button title="Open" onPress={() => openTab(ext.webStoreUrl!)} />
          </Row>
        ) : null}
        {!ext.fromWebStore ? (
          <Row title="Reload" description={ext.path ?? undefined}>
            <Button title="Reload" onPress={() => void reloadExtension(ext.id, profile).finally(() => refreshExtensions(profile))} />
          </Row>
        ) : null}
        {ext.errors.length ? <Row title="Errors" description={ext.errors.slice(0, 5).join("\n")} /> : null}
        <Row title={<Text style={{ ...font.body, color: theme.textTertiary }}>{`ID ${ext.id}`}</Text>} />
      </Group>

      <View style={{ alignItems: "flex-start", marginTop: 18 }}>
        <Button
          title="Remove Extension…"
          kind="destructive"
          disabled={!ext.mayModify}
          onPress={() => void removeExtension(profile, ext, SETTINGS_WINDOW_ID)}
        />
      </View>
    </View>
  );
}
