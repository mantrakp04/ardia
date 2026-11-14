import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateRow, cancelSearch, submitSearch, toggleTrayIncognito } from "../../state/browse/store";
import { menuOpenedHaptic, trayRowActions } from "../../state/browse/tabMenus";
import { useSearchFieldVersion, useSearchInitialText, useSearchOpen, useSearchOrigin, useSearchRows, useSearchSession, useSearchText } from "../../state/search/hooks";
import { refinedText, type TrayRow } from "../../state/search/omnibox";
import { searchState, setSearchText, typeSearch } from "../../state/search/store";
import { useIncognito } from "../../state/tabs/hooks";
import { browseLayout, capsule, FloatingMenu, font, ink, LookFrost, radius, rolesFor, space, springs, Symbol, SURFACES_FROST, tabsInk, tabsLayout, trayShadow, useTheme } from "../ui";
import { SuggestionRow } from "./SuggestionRow";
import { canSearchByVoice, presentVoiceSearch } from "../../state/voice/store";

const LARGE_FONT_SCALE = 1.5;
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
  const incognito = useIncognito();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { lift } = useBottomLift();
  const rise = useRef(new Animated.Value(0)).current;
  const closeOnTouch = useMemo(
    () =>
      Gesture.Manual().onTouchesDown((_event, manager) => {
        runOnJS(cancelSearch)();
        manager.fail();
      }),
    [],
  );

  useEffect(() => {
    rise.setValue(0);
    if (open) Animated.spring(rise, { toValue: 1, ...springs.searchRise, useNativeDriver: true }).start();
  }, [open, rise, session]);

  if (!open) return null;
  const height = Math.max(Math.min(SHEET_ABOVE_KEYBOARD, window.height - lift - space.s - insets.top), 0);
  const travel = height + radius.sheet + lift;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={closeOnTouch}>
        <Pressable
          accessibilityLabel="Close Search"
          accessibilityRole="button"
          onPress={cancelSearch}
          style={[StyleSheet.absoluteFill, { backgroundColor: origin === "page" ? theme.trayDim : ink.clear }]}
        />
      </GestureDetector>
      <Animated.View
        style={[
          styles.sheet,
          {
            bottom: 0,
            height: height + lift,
            paddingBottom: lift,
            backgroundColor: incognito ? theme.surface : ink.clear,
            shadowColor: theme.trayShadow,
            shadowOpacity: trayShadow.opacity,
            shadowRadius: trayShadow.radius,
            shadowOffset: { width: 0, height: trayShadow.offsetY },
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }],
          },
        ]}
      >
        {incognito ? null : <LookFrost source={SURFACES_FROST} variant="sheet" cornerRadius={radius.sheet} fill={theme.surface} style={styles.frost} />}
        <TrayField key={session} />
        <TrayRows />
      </Animated.View>
    </View>
  );
}

function TrayField() {
  const version = useSearchFieldVersion();
  return <FieldInput key={version} first={version === 0} />;
}

function FieldInput({ first }: { first: boolean }) {
  const theme = useTrayTheme();
  const initialText = useSearchInitialText();
  const [start] = useState(() => searchState().text);
  const [hasText, setHasText] = useState(start.length > 0);
  const input = useRef<TextInput>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    first ? (initialText ? { start: 0, end: initialText.length } : undefined) : { start: start.length, end: start.length },
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
          defaultValue={start}
          selection={selection}
          onSelectionChange={() => {
            if (selection) setSelection(undefined);
          }}
          onChangeText={(text) => {
            if (text.length > 0 !== hasText) setHasText(text.length > 0);
            typeSearch(text);
          }}
          onSubmitEditing={(event) => submitSearch(event.nativeEvent.text)}
          placeholder="Search…"
          accessibilityLabel="Search or Enter Address"
          placeholderTextColor={theme.foregroundTertiary}
          selectionColor={theme.formAccent}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          submitBehavior="submit"
          disableFullscreenUI
        />
        {hasText ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear Text" style={styles.accessory} onPress={() => setSearchText("")}>
            <Symbol name="xmarkCircleFill" size={18} color={theme.foregroundTertiary} />
          </Pressable>
        ) : (
          <VoiceButton />
        )}
        <IncognitoToggle />
      </View>
    </View>
  );
}

function VoiceButton() {
  const theme = useTrayTheme();
  const incognito = useIncognito();
  const { fontScale } = useWindowDimensions();
  if (incognito || fontScale > LARGE_FONT_SCALE || !canSearchByVoice()) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Voice Search" style={styles.accessory} onPress={presentVoiceSearch}>
      <Symbol name="mic" size={19} color={theme.foregroundTertiary} />
    </Pressable>
  );
}

function IncognitoToggle() {
  const theme = useTrayTheme();
  const on = useIncognito();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? "Deactivate Incognito" : "Activate Incognito"}
      onPress={toggleTrayIncognito}
      style={styles.incognito}
    >
      {on ? <Text style={[font.footnote, styles.medium, { color: tabsInk.onDarkSoft }]}>Incognito</Text> : null}
      <Symbol name="eyeglasses" size={22} color={on ? tabsInk.onDark : theme.foregroundTertiary} />
    </Pressable>
  );
}

function TrayRows() {
  const theme = useTrayTheme();
  const rows = useSearchRows();
  const typed = useSearchText();
  const incognito = useIncognito();
  const { keyboard } = useBottomLift();
  const [room, setRoom] = useState(0);
  const [bottoms, setBottoms] = useState<number[]>([]);
  const refine = useCallback((row: TrayRow) => setSearchText(refinedText(row)), []);
  const [menu, setMenu] = useState<{ row: TrayRow; y: number } | null>(null);
  const window = useWindowDimensions();
  const showMenu = useCallback((row: TrayRow, y: number) => {
    if (!trayRowActions(row).length) return;
    menuOpenedHaptic();
    setMenu({ row, y });
  }, []);
  const shown = keyboard
    ? null
    : wholeRowsHeight(
        rows.map((_row, index) => bottoms[index] ?? 0),
        room,
      );
  if (incognito && !typed.trim()) {
    return (
      <View style={[styles.rows, styles.incognitoNote]}>
        <Text style={[font.title3, styles.medium, { color: tabsInk.onDarkSoft }]}>You’re browsing Incognito</Text>
      </View>
    );
  }
  return (
    <View style={styles.rows} onLayout={(event) => setRoom(event.nativeEvent.layout.height)}>
      <ScrollView
        style={shown === null ? styles.rows : { height: shown, flexGrow: 0 }}
        contentContainerStyle={styles.rowsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {rows.map((row, index) => (
          <View
            key={index}
            onLayout={
              keyboard
                ? undefined
                : (event) => {
                    const bottom = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
                    setBottoms((known) => (known[index] === bottom ? known : Object.assign([...known], { [index]: bottom })));
                  }
            }
          >
            <SuggestionRow row={row} typed={typed} roles={theme} onActivate={activateRow} onRefine={refine} onMenu={showMenu} />
          </View>
        ))}
      </ScrollView>
      {menu ? (
        <FloatingMenu
          items={trayRowActions(menu.row).map((action) => ({ label: action.label, icon: action.icon, onPress: action.run }))}
          place={{
            top: Math.max(space.l, Math.min(menu.y, window.height - tabsLayout.cardMenuHeight)),
            left: space.xl,
            width: Math.min(tabsLayout.menuWidth, window.width - space.xl * 2),
          }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
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
  frost: { position: "absolute", top: 0, left: 0, right: 0, bottom: -radius.sheet },
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
  incognito: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs + 2,
    minWidth: 36,
    minHeight: 40,
    justifyContent: "flex-end",
    paddingLeft: space.xs + 2,
  },
  incognitoNote: { alignItems: "center", paddingTop: space.huge },
  medium: { fontWeight: "500" },
  rowsContent: { paddingHorizontal: space.s, paddingBottom: space.s },
});
