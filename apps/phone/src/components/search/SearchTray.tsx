import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateRow, cancelSearch, submitSearch } from "../../state/browse/store";
import { useSearchInitialText, useSearchOpen, useSearchOrigin, useSearchRows, useSearchSession, useSearchText } from "../../state/search/hooks";
import { refinedText, type TrayRow } from "../../state/search/omnibox";
import { typeSearch } from "../../state/search/store";
import { useIncognito } from "../../state/tabs/hooks";
import { browseLayout, capsule, font, ink, radius, rolesFor, space, springs, Symbol, tabsInk, trayShadow, useTheme } from "../ui";
import { SuggestionRow } from "./SuggestionRow";
import { useBottomLift } from "./useKeyboardHeight";

const SHEET_ABOVE_KEYBOARD = 274;

function useTrayTheme() {
  const base = useTheme();
  const incognito = useIncognito();
  return incognito ? { ...base, ...rolesFor(true), surface: tabsInk.incognitoSheet } : base;
}

export function SearchTray() {
  const open = useSearchOpen();
  const origin = useSearchOrigin();
  const session = useSearchSession();
  const theme = useTrayTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { lift } = useBottomLift();
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    rise.setValue(0);
    if (open) Animated.spring(rise, { toValue: 1, ...springs.searchRise, useNativeDriver: true }).start();
  }, [open, rise, session]);

  if (!open) return null;
  const height = Math.max(Math.min(SHEET_ABOVE_KEYBOARD, window.height - lift - space.s - insets.top), 0);
  const travel = height + radius.sheet + lift;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        accessibilityLabel="Close"
        style={[StyleSheet.absoluteFill, { backgroundColor: origin === "page" ? theme.trayDim : ink.clear }]}
        onPressIn={cancelSearch}
      />
      <Animated.View
        style={[
          styles.sheet,
          {
            bottom: 0,
            height: height + lift,
            paddingBottom: lift,
            backgroundColor: theme.surface,
            shadowColor: theme.trayShadow,
            shadowOpacity: trayShadow.opacity,
            shadowRadius: trayShadow.radius,
            shadowOffset: { width: 0, height: trayShadow.offsetY },
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }],
          },
        ]}
      >
        <TrayField key={session} />
        <TrayRows />
      </Animated.View>
    </View>
  );
}

function TrayField() {
  const theme = useTrayTheme();
  const initialText = useSearchInitialText();
  const text = useSearchText();
  const input = useRef<TextInput>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    initialText ? { start: 0, end: initialText.length } : undefined,
  );

  useEffect(() => {
    const focus = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(focus);
  }, []);

  return (
    <View style={styles.fieldArea}>
      <View style={[styles.field, { backgroundColor: theme.fieldFill, borderColor: theme.fieldStroke }]}>
        <TextInput
          ref={input}
          style={[font.body, styles.input, { color: theme.foregroundPrimary }]}
          value={text}
          selection={selection}
          onSelectionChange={() => setSelection(undefined)}
          onChangeText={typeSearch}
          onSubmitEditing={(event) => submitSearch(event.nativeEvent.text)}
          placeholder="Search or Enter URL"
          placeholderTextColor={theme.foregroundTertiary}
          selectionColor={theme.formAccent}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          submitBehavior="submit"
          disableFullscreenUI
        />
        {text ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear Text" style={styles.accessory} onPress={() => typeSearch("")}>
            <Symbol name="xmarkCircleFill" size={18} color={theme.foregroundTertiary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TrayRows() {
  const theme = useTrayTheme();
  const rows = useSearchRows();
  const typed = useSearchText();
  const { keyboard } = useBottomLift();
  const [room, setRoom] = useState(0);
  const [bottoms, setBottoms] = useState<Record<string, number>>({});
  const refine = (row: TrayRow) => typeSearch(refinedText(row));
  const shown = keyboard ? null : wholeRowsHeight(rows.map((row) => bottoms[row.key] ?? 0), room);
  return (
    <View style={styles.rows} onLayout={(event) => setRoom(event.nativeEvent.layout.height)}>
      <ScrollView
        style={shown === null ? styles.rows : { height: shown, flexGrow: 0 }}
        contentContainerStyle={styles.rowsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {rows.map((row) => (
          <View
            key={row.key}
            onLayout={(event) => {
              const bottom = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
              setBottoms((known) => (known[row.key] === bottom ? known : { ...known, [row.key]: bottom }));
            }}
          >
            <SuggestionRow row={row} typed={typed} roles={theme} onActivate={activateRow} onRefine={refine} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function wholeRowsHeight(bottoms: number[], room: number): number | null {
  if (room <= 0 || bottoms.some((bottom) => bottom <= 0)) return null;
  const last = bottoms[bottoms.length - 1] ?? 0;
  if (last <= room) return null;
  const fitting = bottoms.filter((bottom) => bottom <= room);
  return fitting.length ? Math.max(...fitting) : null;
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    elevation: trayShadow.elevation,
    overflow: "hidden",
  },
  fieldArea: { paddingHorizontal: browseLayout.searchFieldInset, paddingTop: browseLayout.trayFieldTop, paddingBottom: space.s },
  field: {
    minHeight: browseLayout.searchFieldHeight,
    borderRadius: capsule(browseLayout.searchFieldHeight),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: browseLayout.fieldLeading,
    paddingRight: browseLayout.fieldTrailing,
  },
  input: { flex: 1, paddingVertical: 0, minHeight: browseLayout.searchFieldHeight },
  accessory: { width: browseLayout.accessory.width, height: browseLayout.accessory.height, alignItems: "center", justifyContent: "center" },
  rows: { flex: 1 },
  rowsContent: { paddingHorizontal: space.s, paddingBottom: space.s },
});
