import { useEffect, useId, useMemo } from "react";
import { Pressable, View } from "react-native";
import { Button, KeyCap, space, Symbol, Text, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import { useSettings } from "../../state/browser/hooks";
import { useProfileOrder } from "../../state/profiles/hooks";
import { resolvedShortcuts, useMenuBarRevision, type MenuShortcut } from "../../state/commands/commandShortcuts";
import {
  cancelShortcutRecordingFor,
  clearShortcut,
  NO_SHORTCUT,
  recordShortcutFor,
  resetShortcut,
  useRecordingShortcut,
  type ShortcutRecordingPlace,
} from "../../state/commands/shortcutRecording";
import { formatShortcut, type Shortcut } from "../../state/commands/shortcuts";

export type ShortcutEditor = {
  combo: Shortcut;
  remappable: boolean;
  customized: boolean;
  recording: boolean;
  conflicts: string[];
  record: () => void;
  clear: () => void;
  reset: () => void;
};

const itemsByIdOf = new WeakMap<readonly MenuShortcut[], Map<string, MenuShortcut>>();

function menuItemsById(items: readonly MenuShortcut[]) {
  let byId = itemsByIdOf.get(items);
  if (!byId) itemsByIdOf.set(items, (byId = new Map(items.map((item) => [item.id, item]))));
  return byId;
}

export function useShortcutEditor(id: string, place: ShortcutRecordingPlace, items: readonly MenuShortcut[] | undefined): ShortcutEditor {
  const owner = useId();
  const overrides = useSettings((s) => s.shortcuts);
  const profileOrder = useProfileOrder();
  const menuBar = useMenuBarRevision();
  const recording = useRecordingShortcut(owner, id);
  useEffect(() => () => cancelShortcutRecordingFor(owner), [owner]);
  const resolved = useMemo(() => resolvedShortcuts({ settings: { shortcuts: overrides }, profileOrder }), [overrides, profileOrder, menuBar]);
  const byId = items ? menuItemsById(items) : undefined;
  return {
    combo: resolved.bindings.get(id)?.[0] ?? NO_SHORTCUT,
    remappable: byId?.get(id)?.remappable ?? true,
    customized: !!overrides[id],
    recording,
    conflicts: resolved.conflictsOf(id).flatMap((other) => byId?.get(other)?.title ?? []),
    record: () => void recordShortcutFor(owner, id, place),
    clear: () => clearShortcut(id),
    reset: () => resetShortcut(id),
  };
}

export function ShortcutKeys({ editor }: { editor: ShortcutEditor }) {
  return (
    <>
      {editor.customized && <Button variant="icon" icon="arrow.uturn.backward" size="m" onPress={editor.reset} tooltip="Reset to Default" />}
      <ShortcutField editor={editor} />
    </>
  );
}

export function ShortcutConflict({ titles }: { titles: string[] }) {
  return (
    <Text size="caption" tone="warning" style={CONFLICT}>
      {`${titles.length === 1 ? "This shortcut conflicts with another shortcut:" : "This shortcut conflicts with other shortcuts:"} ${titles.join(", ")}`}
    </Text>
  );
}

function ShortcutField({ editor: { combo, remappable, recording, record, clear } }: { editor: ShortcutEditor }) {
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
      <Pressable onPress={record}>
        <KeyCap keys={[text || "None"]} editing={recording} empty={!text} hovered={hovered} />
      </Pressable>
      {hovered && !recording && combo.key ? (
        <Pressable onPress={clear} tooltip="Remove Shortcut" style={CLEAR}>
          <Symbol name="xmark.circle.fill" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
        </Pressable>
      ) : null}
    </View>
  );
}

const CONFLICT = { marginTop: space.xxs } as const;
const FIXED_KEYS = { minWidth: 110, alignItems: "flex-end" } as const;
const KEY_FIELD = { minWidth: 110, justifyContent: "center" } as const;
const CLEAR = { position: "absolute", right: space.xs } as const;
