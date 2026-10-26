import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { claimFocusTag, findFocus } from "../../state/focus/focusClaims";
import { useEffect, useRef, useState } from "react";
import { Animated, findNodeHandle, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { useFind, useTab } from "../../state/browser/hooks";
import { currentTab } from "../../state/browser/current";
import { setFind as setTabFind } from "../../state/windows/actions";
import type { FindState } from "../../state/browser/types";
import { Button, font, Panel, radius, space, Symbol } from "../ui";
import { replaceInField } from "../../state/site/selection";
import { FIND_APPEAR, FIND_SHADOW } from "./tokens";

export function FindBar({ tabId }: { tabId: string }) {
  const hasPage = useTab(tabId, (t) => !!t?.url);
  const find = useFind(tabId);
  if (!find.open || !hasPage) return null;
  return <FindBarPanel key={tabId} tabId={tabId} find={find} />;
}

const handledFocus = new Map<string, number>();
const FIND_KEYS = [
  { key: "Escape" },
  { key: "Enter" },
  { key: "Enter", shiftKey: true },
  { key: "Enter", altKey: true },
  { key: "Enter", altKey: true, shiftKey: true },
];

function FindBarPanel({ tabId, find }: { tabId: string; find: FindState }) {
  const previousHint = useShortcutHint("findPrevious");
  const nextHint = useShortcutHint("findNext");
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, ...FIND_APPEAR, useNativeDriver: true }).start();
  }, []);
  useEffect(() => {
    const request = find.focusRequest;
    if (!request || handledFocus.get(tabId) === request) return;
    handledFocus.set(tabId, request);
    input.current?.focus();
    input.current?.setSelection(0, find.query.length);
    const windowId = currentTab(tabId)?.windowId;
    if (windowId) claimFocusTag(windowId, findFocus(tabId), () => findNodeHandle(input.current));
    if (find.query) void webviews.get(tabId)?.find(find.query, true, false);
  }, [find.focusRequest]);

  const setFind = (patch: Partial<FindState>) => setTabFind(tabId, patch);
  const run = (backwards: boolean, query = find.query, findNext = true) => {
    if (!query) setFind({ count: null, active: 0 });
    void webviews.get(tabId)?.find(query, !backwards, findNext);
  };
  const close = () => {
    setFind({ open: false, count: null, active: 0 });
    void webviews.get(tabId)?.stopFinding(false);
    void webviews.get(tabId)?.focus();
  };
  const [replacement, setReplacement] = useState("");
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2200);
    return () => clearTimeout(timer);
  }, [note]);
  const replace = async (all: boolean) => {
    if (!find.query) return;
    const { field, count } = await replaceInField(tabId, find.query, replacement, all);
    if (!field) return setNote({ text: "Not in a text field", error: true });
    if (all || !count) setNote({ text: count ? `${count} replaced` : "No matches", error: !count });
    run(false, find.query, false);
  };
  const none = find.count === 0 && !!find.query;
  const separator = theme.divider;

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: space.ml,
        right: space.l,
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
    >
      <Panel fill={theme.panel} radius={radius.panel} border={theme.panelBorder} shadow={FIND_SHADOW} style={{ width: 340 }}>
        <View style={{ height: 40, flexDirection: "row", alignItems: "center", paddingLeft: 11, paddingRight: space.xs, gap: space.xxs }}>
          <Symbol name="magnifyingglass" size={13} color={theme.textSecondary} style={{ width: 16, height: 16, marginRight: 5 }} />
          <TextInput
            ref={input}
            autoFocus
            value={find.query}
            onChangeText={(query) => {
              setFind({ query });
              run(false, query, false);
            }}
            placeholder="Find on Page"
            placeholderTextColor={theme.placeholder}
            selectionColor={theme.selection}
            enableFocusRing={false}
            onSubmitEditing={() => run(false)}
            keyDownEvents={FIND_KEYS}
            onKeyDown={(e) => {
              const { key, shiftKey, ctrlKey, metaKey } = e.nativeEvent;
              if (key === "Escape") close();
              else if (key === "Enter" && !ctrlKey && !metaKey) run(!!shiftKey);
            }}
            style={{ flex: 1, ...font.title, color: theme.textPrimary, paddingVertical: 0 }}
          />
          {none ? (
            <Text style={{ ...font.small, color: theme.destructive, marginRight: space.s }}>No results</Text>
          ) : find.count !== null && !!find.query ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.s, marginRight: space.s }}>
              <Text style={{ ...font.small, color: theme.textPrimary, fontVariant: ["tabular-nums"] }}>{find.active}</Text>
              <View style={{ width: StyleSheet.hairlineWidth * 2, height: 12, backgroundColor: separator }} />
              <Text style={{ ...font.small, color: theme.textSecondary, fontVariant: ["tabular-nums"] }}>{find.count}</Text>
            </View>
          ) : null}
          <Button variant="icon" icon="chevron.up" size={12} box={26} radius={radius.m} disabled={!find.count} onPress={() => run(true)} tooltip={withShortcut("Previous", previousHint)} />
          <Button variant="icon" icon="chevron.down" size={12} box={26} radius={radius.m} disabled={!find.count} onPress={() => run(false)} tooltip={withShortcut("Next", nextHint)} />
          <View style={{ width: 1, height: 18, marginHorizontal: 3, backgroundColor: separator }} />
          <Button variant="icon" icon="xmark" size={11} box={26} radius={radius.m} onPress={close} tooltip="Done (Esc)" />
        </View>
        {find.replace && <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: separator }} />}
        {find.replace && (
          <View style={{ height: 38, flexDirection: "row", alignItems: "center", paddingLeft: 11, paddingRight: space.s, gap: space.xs }}>
            <Symbol name="arrow.triangle.swap" size={12} color={theme.textSecondary} style={{ width: 16, height: 16, marginRight: 3 }} />
            <TextInput
              value={replacement}
              onChangeText={setReplacement}
              placeholder="Replace"
              placeholderTextColor={theme.placeholder}
              selectionColor={theme.selection}
              enableFocusRing={false}
              onSubmitEditing={() => void replace(false)}
              keyDownEvents={[{ key: "Escape" }]}
              onKeyDown={(e) => e.nativeEvent.key === "Escape" && close()}
              style={{ flex: 1, ...font.title, color: theme.textPrimary, paddingVertical: 0 }}
            />
            {note && <Text style={{ ...font.small, color: note.error ? theme.destructive : theme.textSecondary, marginRight: space.xxs }}>{note.text}</Text>}
            <Button variant="text" height={26} title="Replace" disabled={!find.query} onPress={() => void replace(false)} />
            <Button variant="text" height={26} title="All" disabled={!find.query} onPress={() => void replace(true)} />
          </View>
        )}
      </Panel>
    </Animated.View>
  );
}
