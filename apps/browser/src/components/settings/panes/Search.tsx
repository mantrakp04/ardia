import { displayUrl, engineHost, type QuickAction, type SearchEngine } from "@ardia/core";
import { Symbol, Button, font, Sheet, TextField, Toggle } from "../../ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings } from "../../../state/browser/hooks";
import { currentEngineProfile, currentProfileOrder } from "../../../state/browser/current";
import {
  addCustomEngine,
  addQuickAction,
  removeCustomEngine,
  removeQuickAction,
  setSearchEngine,
  updateCustomEngine,
  updateQuickAction,
  updateSettings,
} from "../../../state/settings/actions";
import { controllingSearchExtension, defaultSearchEngine, searchEngines } from "../../../state/settings/settings";
import { extensionsProfileId, setEnabled } from "../../../state/extensions/actions";
import { Favicon } from "../../favicon/Favicon";
import { Group, Row, SectionHeader, SettingToggle, SheetActions, SheetTitle } from "../Form";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { openSettings } from "../../../state/settings/settingsWindows";

function manageExtensionsOf(profile: string) {
  const profileId = currentProfileOrder().find((id) => currentEngineProfile(id) === profile);
  openSettings("extensions", extensionsProfileId(profileId));
}

export function SearchPane() {
  const engines = useSettings(searchEngines);
  const selectedId = useSettings((s) => defaultSearchEngine(s).id);
  const controlling = useSettings(controllingSearchExtension);
  const suggestions = useSettings((s) => s.searchSuggestions);
  const quickActions = useSettings((s) => s.quickActions);
  const theme = useTheme();
  const builtIn = engines.filter((e) => !e.custom && !e.extension);
  const custom = engines.filter((e) => e.custom);
  const fromExtensions = engines.filter((e) => e.extension);
  const locked = !!controlling;

  return (
    <View>
      <SectionHeader anchor="search.defaultEngine" />
      <Group>
        {controlling && (
          <Row
            icon={<Symbol name="puzzlepiece.extension" size={13} color={theme.formAccent} style={{ width: 18, height: 18 }} />}
            title={`${controlling.extensionName || "An extension"} is controlling this setting`}
            description="To change your default search engine, disable the extension or manage its settings."
          >
            <Button title="Manage" onPress={() => manageExtensionsOf(controlling.profile)} />
            <Button title="Disable" onPress={() => void setEnabled(controlling.profile, controlling.extensionId, false)} />
          </Row>
        )}
        {builtIn.map((e) => (
          <EngineRow key={e.id} engine={e} selected={selectedId === e.id} locked={locked} />
        ))}
      </Group>

      <SectionHeader
        anchor="search.otherEngines"
        action={<Button title="Add…" icon="plus" onPress={() => showSettingsSheet(<EngineSheet />)} />}
      />
      <Group of="search.otherEngines">
        {custom.length === 0 ? (
          <Row title="No custom search engines" description="Add one with a URL where %s stands for the search terms." />
        ) : (
          custom.map((e) => <EngineRow key={e.id} engine={e} selected={selectedId === e.id} locked={locked} editable={e.id !== "custom"} />)
        )}
      </Group>

      {fromExtensions.length > 0 && (
        <>
          <SectionHeader title="Extensions" description="Some extensions can add search engines to Ardia." />
          <Group>
            {fromExtensions.map((e) => (
              <EngineRow key={e.id} engine={e} selected={selectedId === e.id} locked={locked} />
            ))}
          </Group>
        </>
      )}

      <SectionHeader anchor="search.quickActions" action={<Button title="Add…" icon="plus" onPress={() => showSettingsSheet(<QuickActionSheet />)} />} />
      <Group of="search.quickActions">
        {quickActions.length === 0 ? (
          <Row title="No quick actions" description="Add a keyword, such as “open github”, and the URL it opens." />
        ) : (
          quickActions.map((a) => <QuickActionRow key={a.id} action={a} />)
        )}
      </Group>

      <SectionHeader title="Suggestions" />
      <Group>
        <Row anchor="search.suggestions">
          <Toggle value={suggestions} onChange={(v) => updateSettings({ searchSuggestions: v })} />
        </Row>
      </Group>

      <SectionHeader title="Text selection" />
      <Group>
        <SettingToggle anchor="search.showSelectionSearch" />
      </Group>
    </View>
  );
}

function EngineRow({ engine, selected, locked, editable }: { engine: SearchEngine; selected: boolean; locked: boolean; editable?: boolean }) {
  const theme = useTheme();
  const description = engine.extension
    ? `${engine.keyword ? `${engine.keyword} · ` : ""}Added by ${engine.extension.name || "an extension"}`
    : engine.custom
      ? `${engine.keyword} · ${engine.url}`
      : engine.keyword;
  return (
    <Row icon={<Favicon url={`https://${engineHost(engine)}`} />} title={engine.name} description={description}>
      {editable && (
        <Button variant="icon" icon="pencil" size={11} box={24} radius={6} onPress={() => showSettingsSheet(<EngineSheet engine={engine} />)} tooltip="Edit" />
      )}
      {selected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 92, justifyContent: "flex-end" }}>
          <Symbol name="checkmark" size={11} weight="semibold" color={theme.formAccent} style={{ width: 14, height: 14 }} />
          <Text style={{ ...font.small, color: theme.textSecondary }}>Default</Text>
        </View>
      ) : (
        <Button title="Make Default" disabled={locked} onPress={() => setSearchEngine(engine.id)} style={{ minWidth: 92 }} />
      )}
    </Row>
  );
}

function EngineSheet({ engine }: { engine?: SearchEngine }) {
  const theme = useTheme();
  const [name, setName] = useState(engine?.name ?? "");
  const [keyword, setKeyword] = useState(engine?.keyword ?? "");
  const [url, setUrl] = useState(engine?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const input = { name, keyword, url };
    let result: string | null;
    if (engine) result = updateCustomEngine(engine.id, input);
    else {
      const added = addCustomEngine(input);
      result = "error" in added ? added.error : null;
    }
    if (result) return setError(result);
    closeSettingsSheet();
  };
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <View style={{ marginTop: 12 }}>
      <Text style={{ ...font.footnote, marginBottom: 5, color: theme.textSecondary }}>{label}</Text>
      <TextField value={value} onChangeText={set} placeholder={placeholder} onSubmit={save} onEscape={closeSettingsSheet} />
    </View>
  );
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <SheetTitle>{engine ? "Edit Search Engine" : "Add Search Engine"}</SheetTitle>
      {field("Name", name, setName, "Wikipedia")}
      {field("Shortcut", keyword, setKeyword, "w")}
      {field("URL with %s in place of the query", url, setUrl, "https://en.wikipedia.org/w/index.php?search=%s")}
      {error && <Text style={{ ...font.small, marginTop: 10, color: theme.destructive }}>{error}</Text>}
      <SheetActions
        destructive={
          engine ? (
            <Button
              title="Delete"
              kind="destructive"
              onPress={() => {
                removeCustomEngine(engine.id);
                closeSettingsSheet();
              }}
            />
          ) : null
        }
      >
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={engine ? "Save" : "Add"} kind="primary" onPress={save} />
      </SheetActions>
    </Sheet>
  );
}

function QuickActionRow({ action }: { action: QuickAction }) {
  return (
    <Row icon={<Favicon url={action.url} />} title={action.keyword} description={displayUrl(action.url)}>
      <Button variant="icon" icon="pencil" size={11} box={24} radius={6} onPress={() => showSettingsSheet(<QuickActionSheet action={action} />)} tooltip="Edit" />
    </Row>
  );
}

function QuickActionSheet({ action }: { action?: QuickAction }) {
  const theme = useTheme();
  const [keyword, setKeyword] = useState(action?.keyword ?? "");
  const [url, setUrl] = useState(action?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const input = { keyword, url };
    let result: string | null;
    if (action) result = updateQuickAction(action.id, input);
    else {
      const added = addQuickAction(input);
      result = "error" in added ? added.error : null;
    }
    if (result) return setError(result);
    closeSettingsSheet();
  };
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <View style={{ marginTop: 12 }}>
      <Text style={{ ...font.footnote, marginBottom: 5, color: theme.textSecondary }}>{label}</Text>
      <TextField value={value} onChangeText={set} placeholder={placeholder} onSubmit={save} onEscape={closeSettingsSheet} />
    </View>
  );
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <SheetTitle>{action ? "Edit Quick Action" : "Add Quick Action"}</SheetTitle>
      {field("Keyword", keyword, setKeyword, "open github")}
      {field("URL", url, setUrl, "https://github.com")}
      {error && <Text style={{ ...font.small, marginTop: 10, color: theme.destructive }}>{error}</Text>}
      <SheetActions
        destructive={
          action ? (
            <Button
              title="Delete"
              kind="destructive"
              onPress={() => {
                removeQuickAction(action.id);
                closeSettingsSheet();
              }}
            />
          ) : null
        }
      >
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={action ? "Save" : "Add"} kind="primary" onPress={save} />
      </SheetActions>
    </Sheet>
  );
}
