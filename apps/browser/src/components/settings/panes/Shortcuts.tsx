import { type MenuShortcut, resolvedShortcuts, useMenuBarRevision } from "../../../state/commands/commandShortcuts";
import { Box, Button, EmptyState, PopUp, SearchField, space, Toggle } from "../../ui";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useSettings } from "../../../state/browser/hooks";
import { useProfileOrder } from "../../../state/profiles/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { openUrls } from "../../../state/browser/actions";
import { Anchor, Group, PaneIntro, Row, SectionHeader } from "../Form";
import { shortcutItems } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { NO_SHORTCUT } from "../../../state/commands/shortcutRecording";
import { shortcutMatchesQuery } from "../../../state/commands/shortcutSearch";
import { ShortcutConflict, ShortcutKeys, useShortcutEditor } from "../ShortcutEditor";

type Filter = "all" | "customized" | "conflicts";

export function ShortcutsPane() {
  const overrides = useSettings((s) => s.shortcuts);
  const profileOrder = useProfileOrder();
  const menuBar = useMenuBarRevision();
  const undoReopensClosedTab = useSettings((s) => s.undoReopensClosedTab);
  const [loaded] = useResource(shortcutItems);
  const items = loaded ?? null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const resolved = useMemo(() => resolvedShortcuts({ settings: { shortcuts: overrides }, profileOrder }), [items, overrides, profileOrder, menuBar]);
  const byId = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  const conflictsOf = (item: MenuShortcut) => resolved.conflictsOf(item.id).flatMap((id) => byId.get(id) ?? []);

  const shown = (items ?? []).filter((item) => {
    if (!shortcutMatchesQuery(query, item, resolved.bindings.get(item.id)?.[0] ?? NO_SHORTCUT)) return false;
    if (filter === "customized") return !!overrides[item.id];
    if (filter === "conflicts") return conflictsOf(item).length > 0;
    return true;
  });
  const menus = [...new Set(shown.map((i) => i.path[0] ?? ""))];
  const customizedCount = Object.keys(overrides).length;

  return (
    <View>
      <Box gap="xl">
        <PaneIntro>Perform common actions in Ardia faster and from anywhere. Select an action to customize its keyboard shortcut.</PaneIntro>
        <Group>
          <Row anchor="shortcuts.undoReopensClosedTab">
            <Toggle value={undoReopensClosedTab} onChange={(v) => updateSettings({ undoReopensClosedTab: v })} />
          </Row>
        </Group>
        <Anchor id="shortcuts.actions" shape="row" style={TOOLBAR}>
          <View style={FILL}>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search actions" />
          </View>
          <PopUp
            value={filter}
            options={[
              { value: "all", title: "All Shortcuts" },
              { value: "customized", title: "Customized Shortcuts" },
              { value: "conflicts", title: "Conflicting Shortcuts" },
            ]}
            onChange={setFilter}
            minWidth={170}
          />
          <Button title="Reset All Shortcuts" disabled={!customizedCount} onPress={() => updateSettings({ shortcuts: {} })} />
        </Anchor>
      </Box>
      {items !== null && shown.length === 0 && (
        <View style={NO_MATCH}>
          <EmptyState symbol="magnifyingglass" title="No matching actions" />
        </View>
      )}
      {menus.map((menu) => (
        <View key={menu}>
          <SectionHeader title={menu} />
          <Group>
            {shown
              .filter((i) => (i.path[0] ?? "") === menu)
              .map((item) => (
                <ShortcutRow key={item.id} item={item} items={loaded} />
              ))}
          </Group>
        </View>
      ))}
      {filter === "all" && !query && (
        <>
          <SectionHeader title="Extensions" />
          <Group>
            <Row anchor="shortcuts.extensionShortcuts">
              <Button title="Edit…" onPress={() => openUrls(["chrome://extensions/shortcuts"])} />
            </Row>
          </Group>
        </>
      )}
    </View>
  );
}

function ShortcutRow({ item, items }: { item: MenuShortcut; items: readonly MenuShortcut[] | undefined }) {
  const editor = useShortcutEditor(item.id, "shortcutsPane", items);
  return (
    <Row
      title={item.title}
      description={editor.conflicts.length ? <ShortcutConflict titles={editor.conflicts} /> : item.path.length > 1 ? item.path.slice(1).join(" › ") : undefined}
    >
      <ShortcutKeys editor={editor} />
    </Row>
  );
}

const TOOLBAR = { flexDirection: "row", alignItems: "center", gap: space.m } as const;
const FILL = { flex: 1 } as const;
const NO_MATCH = { marginTop: space.huge } as const;
