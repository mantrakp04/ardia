import { siteSearches, siteKeywords, normalizeSearchKeyword, validSiteSearchOverride, searchUrlFor, type SiteSearch } from "@ardia/core";
import { useState } from "react";
import { Button, DialogActions, DialogTitle, Sheet, Text, TextField, Toggle } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { useSettings } from "../../../state/browser/hooks";
import { currentSettings, resolvedWindowId } from "../../../state/browser/current";
import { updateSettings } from "../../../state/settings/actions";
import { searchEngines } from "../../../state/settings/settings";
import { newTab } from "../../../state/tabs/actions";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { FormField, Group, Row, SectionHeader } from "../Form";

export function SearchShortcuts() {
  const overrides = useSettings((s) => s.siteSearchOverrides);
  return (
    <>
      <SectionHeader anchor="search.siteShortcuts" />
      <Group of="search.siteShortcuts">
        {siteSearches(overrides).map((site) => (
          <Row key={site.host} icon={<Favicon url={`https://${site.host}`} />} title={site.name} description={`${siteKeywords(site).join(", ")}${site.action === "ask" ? " · New chat" : ""}`}>
            <Button variant="icon" icon="pencil" size="m" onPress={() => showSettingsSheet(<ShortcutSheet site={site} />)} tooltip="Edit shortcut" />
            <Toggle value={site.enabled !== false} onChange={(enabled) => updateSettings({ siteSearchOverrides: {
              ...currentSettings().siteSearchOverrides,
              [site.host]: { name: site.name, keyword: siteKeywords(site)[0]!, aliases: site.aliases ?? [], url: site.url, enabled },
            } })} />
          </Row>
        ))}
      </Group>
    </>
  );
}

function ShortcutSheet({ site }: { site: SiteSearch }) {
  const [name, setName] = useState(site.name);
  const [keyword, setKeyword] = useState(siteKeywords(site)[0]!);
  const [aliases, setAliases] = useState(site.aliases?.join(", ") ?? "");
  const [url, setUrl] = useState(site.url);
  const [example, setExample] = useState("example");
  const [error, setError] = useState<string | null>(null);
  const input = () => ({ name: name.trim(), keyword: normalizeSearchKeyword(keyword), aliases: aliases.split(",").map(normalizeSearchKeyword).filter(Boolean), url: url.trim(), enabled: site.enabled !== false });
  const validate = () => {
    const value = input();
    if (!validSiteSearchOverride(value)) return "Enter a name, a shortcut without spaces, and a valid http(s) search URL containing %s.";
    const keys = [value.keyword, ...value.aliases];
    if (new Set(keys).size !== keys.length) return "Each shortcut and alias must be different.";
    const settings = currentSettings();
    const other = siteSearches(settings.siteSearchOverrides).filter((s) => s.host !== site.host);
    if (other.some((s) => [s.host, ...siteKeywords(s)].some((k) => keys.includes(normalizeSearchKeyword(k))))) return "That shortcut or alias belongs to another site.";
    if (searchEngines(settings).some((e) => [e.keyword, ...(e.aliases ?? [])].some((k) => keys.includes(normalizeSearchKeyword(k))))) return "That shortcut or alias belongs to a search engine.";
    return null;
  };
  const save = () => {
    const invalid = validate();
    if (invalid) return setError(invalid);
    updateSettings({ siteSearchOverrides: { ...currentSettings().siteSearchOverrides, [site.host]: input() } });
    closeSettingsSheet();
  };
  const field = (label: string, value: string, change: (v: string) => void, placeholder: string) => (
    <FormField label={label}>
      <TextField value={value} onChangeText={change} placeholder={placeholder} onSubmit={save} onEscape={closeSettingsSheet} />
    </FormField>
  );
  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle>Edit Search Shortcut</DialogTitle>
      {field("Name", name, setName, "Google Docs")}
      {field("Shortcut", keyword, setKeyword, "docs")}
      {field("Aliases, separated by commas", aliases, setAliases, "documents")}
      {field("URL with %s in place of the query", url, setUrl, site.url)}
      {field("Test query", example, setExample, "example")}
      <Text selectable size="small" tone="textSecondary">{searchUrlFor(url, example)}</Text>
      <Button title="Test" onPress={() => {
        if (!validSiteSearchOverride(input())) return setError("Enter a valid search URL containing %s.");
        const windowId = resolvedWindowId();
        if (windowId) newTab(windowId, { url: searchUrlFor(url.trim(), example) });
      }} />
      {error && <Text size="caption" tone="destructive">{error}</Text>}
      <DialogActions>
        <Button title="Reset" onPress={() => {
          const overrides = { ...currentSettings().siteSearchOverrides };
          delete overrides[site.host];
          updateSettings({ siteSearchOverrides: overrides });
          closeSettingsSheet();
        }} />
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Save" kind="primary" onPress={save} />
      </DialogActions>
    </Sheet>
  );
}
