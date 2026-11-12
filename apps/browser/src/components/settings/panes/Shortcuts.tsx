import {
  cancelShortcutRecording,
  recordShortcut,
  type MenuShortcut,
  resolvedShortcuts,
  useMenuBarRevision,
} from "../../../state/commands/commandShortcuts";
import { Box, Button, EmptyState, KeyCap, PopUp, SearchField, space, Symbol, Text, Toggle, useHover } from "../../ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings } from "../../../state/browser/hooks";
import { useProfileOrder } from "../../../state/profiles/hooks";
import { setShortcutOverride, updateSettings } from "../../../state/settings/actions";
import { openUrls } from "../../../state/browser/actions";
import { Anchor, Group, PaneIntro, Row, SectionHeader } from "../Form";
import { matchesQuery } from "../../pages/PageLayout";
import { shortcutItems } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { formatShortcut, sameShortcut, type Shortcut } from "../../../state/commands/shortcuts";

type Filter = "all" | "customized" | "conflicts";

const NO_SHORTCUT: Shortcut = { key: "", modifiers: [] };

export function ShortcutsPane() {
  const overrides = useSettings((s) => s.shortcuts);
  const profileOrder = useProfileOrder();
  const menuBar = useMenuBarRevision();
  const undoReopensClosedTab = useSettings((s) => s.undoReopensClosedTab);
  const [loaded] = useResource(shortcutItems);
  const items = loaded ?? null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => () => void cancelShortcutRecording(), []);

  const resolved = useMemo(() => resolvedShortcuts({ settings: { shortcuts: overrides }, profileOrder }), [items, overrides, profileOrder, menuBar]);
  const byId = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  const effective = (item: MenuShortcut): Shortcut => resolved.bindings.get(item.id)?.[0] ?? NO_SHORTCUT;
  const conflictsOf = (item: MenuShortcut) => resolved.conflictsOf(item.id).flatMap((id) => byId.get(id) ?? []);


  const record = async (item: MenuShortcut) => {
    setRecording(item.id);
    const combo = await recordShortcut();
    setRecording(null);
    if (!combo) return;
    const isDefault = sameShortcut(combo, resolved.defaultsOf(item.id)[0] ?? NO_SHORTCUT);
    setShortcutOverride(item.id, isDefault ? null : combo);
  };

  const shown = (items ?? []).filter((item) => {
    if (!matchesQuery(query, item.title, item.path.join(" "), formatShortcut(effective(item)))) return false;
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
              .map((item) => {
                const others = conflictsOf(item);
                return (
                  <Row
                    key={item.id}
                    title={item.title}
                    description={
                      others.length ? (
                        <Text size="caption" tone="warning" style={CONFLICT}>
                          {`${others.length === 1 ? "This shortcut conflicts with another shortcut:" : "This shortcut conflicts with other shortcuts:"} ${others.map((o) => o.title).join(", ")}`}
                        </Text>
                      ) : item.path.length > 1 ? (
                        item.path.slice(1).join(" › ")
                      ) : undefined
                    }
                  >
                    {overrides[item.id] && (
                      <Button variant="icon" icon="arrow.uturn.backward" size="m" onPress={() => setShortcutOverride(item.id, null)} tooltip="Reset to Default" />
                    )}
                    <ShortcutField
                      combo={effective(item)}
                      remappable={item.remappable}
                      recording={recording === item.id}
                      onRecord={() => void record(item)}
                      onClear={() => setShortcutOverride(item.id, resolved.defaultsOf(item.id).length ? NO_SHORTCUT : null)}
                    />
                  </Row>
                );
              })}
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

function ShortcutField({
  combo,
  remappable,
  recording,
  onRecord,
  onClear,
}: {
  combo: Shortcut;
  remappable: boolean;
  recording: boolean;
  onRecord: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const text = recording ? "Type Shortcut" : formatShortcut(combo);
  if (!remappable) {
    return (
      <View style={FIXED_KEYS} tooltip="(not remappable)">
        <Text tone="textTertiary">{text || "—"}</Text>
      </View>
    );
  }
  return (
    <View {...hoverProps} style={KEY_FIELD}>
      <Pressable onPress={onRecord}>
        <KeyCap keys={[text || "None"]} editing={recording} empty={!text} hovered={hovered} />
      </Pressable>
      {hovered && !recording && combo.key ? (
        <Pressable onPress={onClear} tooltip="Remove Shortcut" style={CLEAR}>
          <Symbol name="xmark.circle.fill" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
        </Pressable>
      ) : null}
    </View>
  );
}

const TOOLBAR = { flexDirection: "row", alignItems: "center", gap: space.m } as const;
const FILL = { flex: 1 } as const;
const NO_MATCH = { marginTop: space.huge } as const;
const CONFLICT = { marginTop: space.xxs } as const;
const FIXED_KEYS = { minWidth: 110, alignItems: "flex-end" } as const;
const KEY_FIELD = { minWidth: 110, justifyContent: "center" } as const;
const CLEAR = { position: "absolute", right: space.xs } as const;
