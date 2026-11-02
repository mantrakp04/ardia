import { engineHost, type SearchEngine } from "@ardia/core";
import { Box, Button, DialogActions, DialogTitle, Sheet, space, Symbol, Text, TextField, Toggle } from "../../ui";
import { useState } from "react";
import { View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings } from "../../../state/browser/hooks";
import { currentEngineProfile, currentProfileOrder } from "../../../state/browser/current";
import { addCustomEngine, removeCustomEngine, setSearchEngine, updateCustomEngine, updateSettings } from "../../../state/settings/actions";
import { controllingSearchExtension, defaultSearchEngine, searchEngines } from "../../../state/settings/settings";
import { extensionsProfileId, setEnabled } from "../../../state/extensions/actions";
import { Favicon } from "../../favicon/Favicon";
import { FormField, Group, Row, SectionHeader, SettingToggle } from "../Form";
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
        <Button variant="icon" icon="pencil" size="m" onPress={() => showSettingsSheet(<EngineSheet engine={engine} />)} tooltip="Edit" />
      )}
      {selected ? (
        <Box row gap="xs" style={DEFAULT_MARK}>
          <Symbol name="checkmark" size={11} weight="semibold" color={theme.formAccent} style={{ width: 14, height: 14 }} />
          <Text size="small" tone="textSecondary">
            Default
          </Text>
        </Box>
      ) : (
        <View style={DEFAULT_WIDTH}>
          <Button title="Make Default" disabled={locked} onPress={() => setSearchEngine(engine.id)} />
        </View>
      )}
    </Row>
  );
}

function EngineSheet({ engine }: { engine?: SearchEngine }) {
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
    <FormField label={label}>
      <TextField value={value} onChangeText={set} placeholder={placeholder} onSubmit={save} onEscape={closeSettingsSheet} />
    </FormField>
  );
  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle>{engine ? "Edit Search Engine" : "Add Search Engine"}</DialogTitle>
      {field("Name", name, setName, "Wikipedia")}
      {field("Shortcut", keyword, setKeyword, "w")}
      {field("URL with %s in place of the query", url, setUrl, "https://en.wikipedia.org/w/index.php?search=%s")}
      {error && (
        <Text size="caption" tone="destructive" style={ERROR}>
          {error}
        </Text>
      )}
      <DialogActions
        leading={
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
      </DialogActions>
    </Sheet>
  );
}

const DEFAULT_WIDTH = { minWidth: 92 } as const;
const DEFAULT_MARK = { ...DEFAULT_WIDTH, alignItems: "center", justifyContent: "flex-end" } as const;
const ERROR = { marginTop: space.ml } as const;
