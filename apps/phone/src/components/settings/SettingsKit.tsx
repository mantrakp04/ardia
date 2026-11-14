import { useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rememberSettingsScroll, settingsScroll } from "../../state/settings/nav";
import { Backdrop, FloatingMenu, useSheetFrame, font, ink, settingsLayout, space, Symbol, tabsLayout, Toggle, useTheme, type MenuItem, type SymbolName } from "../ui";

type PageProps = { title: string; onBack?: () => void; leading?: ReactNode; trailing?: ReactNode; children: ReactNode; scroll?: boolean };

export function SettingsPage({ title, onBack, leading, trailing, children, scroll = true }: PageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const list = useRef<ScrollView>(null);
  const restored = useRef(false);
  const frame = useSheetFrame();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={theme.backdrop} />
      <View style={[styles.top, { paddingTop: frame ? 0 : insets.top }]}>
        <View style={styles.topSide}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}>
              <Symbol name="chevronLeft" size={22} color={theme.formAccent} />
            </Pressable>
          ) : null}
          {leading}
        </View>
        <Text accessibilityRole="header" style={[font.body, styles.bold, styles.title, { color: theme.label }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.topSide, styles.end]}>{trailing}</View>
      </View>
      {scroll ? (
        <ScrollView
          ref={list}
          style={{ marginBottom: insets.bottom }}
          contentContainerStyle={[styles.content, { paddingBottom: space.huge }]}
          onContentSizeChange={(_width, height) => {
            if (restored.current || height <= 0) return;
            restored.current = true;
            list.current?.scrollTo({ y: settingsScroll(title), animated: false });
          }}
          onScrollEndDrag={(event) => rememberSettingsScroll(title, event.nativeEvent.contentOffset.y)}
          onMomentumScrollEnd={(event) => rememberSettingsScroll(title, event.nativeEvent.contentOffset.y)}
          keyboardShouldPersistTaps="handled"
          {...frame?.list(false)}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, { paddingBottom: insets.bottom }]}>{children}</View>
      )}
    </View>
  );
}

export function BarButton({ title, onPress, emphasized, enabled = true }: { title: string; onPress: () => void; emphasized?: boolean; enabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={!enabled} onPress={onPress} style={styles.barButton}>
      <Text style={[font.body, emphasized ? styles.bold : null, { color: enabled ? theme.formAccent : theme.tertiaryLabel }]}>{title}</Text>
    </Pressable>
  );
}

export function Group({ header, footer, children }: { header?: string; footer?: string | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.groupOuter}>
      {header ? (
        <Text accessibilityRole="header" style={[font.footnote, styles.groupHeader, { color: theme.secondaryLabel }]}>
          {header}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: theme.groupFill }]}>{children}</View>
      {footer ? <Text style={[font.footnote, styles.groupFooter, { color: theme.secondaryLabel }]}>{footer}</Text> : null}
    </View>
  );
}

export function IconTile({ icon, tint, side = settingsLayout.tile }: { icon: SymbolName; tint: string; side?: number }) {
  return (
    <View style={[styles.tile, { width: side, height: side, borderRadius: side * 0.26, backgroundColor: tint }]}>
      <Symbol name={icon} size={side * 0.62} color={ink.white} />
    </View>
  );
}

function Label({ title, icon, tint, color }: { title: string; icon?: SymbolName; tint?: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.label}>
      {icon && tint ? <IconTile icon={icon} tint={tint} /> : null}
      <Text style={[font.body, styles.labelText, { color: color ?? theme.label }]}>{title}</Text>
    </View>
  );
}

export function Divider({ inset = settingsLayout.rowInset }: { inset?: number }) {
  const theme = useTheme();
  return <View style={[styles.divider, { marginLeft: inset, backgroundColor: theme.separator }]} />;
}

type RowBase = { title: string; icon?: SymbolName; tint?: string; divider?: boolean };

export function NavRow({ title, icon, tint, value, divider, onPress }: RowBase & { value?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={value ? { text: value } : undefined}
        onPress={onPress} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
        <Label title={title} icon={icon} tint={tint} />
        {value ? (
          <Text style={[font.body, styles.value, { color: theme.secondaryLabel }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <Symbol name="chevronRight" size={14} color={theme.tertiaryLabel} />
      </Pressable>
      {divider ? <Divider /> : null}
    </View>
  );
}

export function ToggleRow({ title, icon, tint, divider, value, onChange, detail }: RowBase & { value: boolean; onChange: (value: boolean) => void; detail?: string }) {
  const theme = useTheme();
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.fill}>
          <Label title={title} icon={icon} tint={tint} />
          {detail ? <Text style={[font.footnote, { color: theme.secondaryLabel, marginLeft: icon ? settingsLayout.tile + settingsLayout.labelGap : 0 }]}>{detail}</Text> : null}
        </View>
        <Toggle label={title} value={value} onChange={onChange} />
      </View>
      {divider ? <Divider /> : null}
    </View>
  );
}

export function ButtonRow({ title, onPress, destructive, enabled = true, busy, divider }: { title: string; onPress: () => void; destructive?: boolean; enabled?: boolean; busy?: boolean; divider?: boolean }) {
  const theme = useTheme();
  const color = !enabled ? theme.tertiaryLabel : destructive ? theme.destructive : theme.formAccent;
  return (
    <View>
      <Pressable accessibilityRole="button" disabled={!enabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
        <Text style={[font.body, styles.fill, { color }]}>{title}</Text>
        {busy ? <ActivityIndicator color={theme.secondaryLabel} /> : null}
      </Pressable>
      {divider ? <Divider /> : null}
    </View>
  );
}

export function ValueRow({ title, value, divider }: { title: string; value: string; divider?: boolean }) {
  const theme = useTheme();
  return (
    <View>
      <View accessible accessibilityLabel={value ? `${title}, ${value}` : title} style={styles.row}>
        <Text style={[font.body, styles.fill, { color: theme.label }]}>{title}</Text>
        <Text style={[font.body, { color: theme.secondaryLabel }]}>{value}</Text>
      </View>
      {divider ? <Divider /> : null}
    </View>
  );
}

type PickerProps<T extends string> = RowBase & { options: { id: T; title: string }[]; selected: T; onSelect: (id: T) => void };

export function PickerRow<T extends string>({ title, icon, tint, divider, options, selected, onSelect }: PickerProps<T>) {
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const { width } = useWindowDimensions();
  const [opened, setOpened] = useState(false);
  const current = options.find((option) => option.id === selected)?.title ?? "";
  const open = () => setOpened(true);
  const items: MenuItem[] = options.map((option) => ({ label: option.title, checked: option.id === selected, onPress: () => onSelect(option.id) }));
  return (
    <View ref={anchor} collapsable={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityValue={{ text: current }} onPress={open} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
        <Label title={title} icon={icon} tint={tint} />
        <Text style={[font.body, styles.value, { color: theme.secondaryLabel }]} numberOfLines={1}>
          {current}
        </Text>
        <Symbol name="chevronUp" size={12} color={theme.tertiaryLabel} />
      </Pressable>
      {divider ? <Divider /> : null}
      {opened ? <FloatingMenu items={items} anchor={anchor} place={{ right: space.l * 2, width: Math.min(tabsLayout.menuWidth, width - space.huge * 2) }} onDismiss={() => setOpened(false)} /> : null}
    </View>
  );
}

export function EmptyState({ title, message, icon }: { title: string; message: string; icon: SymbolName }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Symbol name={icon} size={44} color={theme.tertiaryLabel} />
      <Text style={[font.title3, styles.bold, { color: theme.label }]}>{title}</Text>
      {message ? <Text style={[font.subheadline, styles.centered, { color: theme.secondaryLabel }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", minHeight: settingsLayout.topBar, paddingHorizontal: space.s },
  topSide: { flex: 1, flexDirection: "row", alignItems: "center" },
  end: { justifyContent: "flex-end" },
  title: { maxWidth: settingsLayout.titleWidth, textAlign: "center" },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  barButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.s },
  bold: { fontWeight: "600" },
  content: { paddingTop: space.m, gap: space.xxl },
  fill: { flex: 1 },
  groupOuter: { paddingHorizontal: space.l },
  groupHeader: { paddingLeft: settingsLayout.rowInset, paddingBottom: space.s, fontWeight: "600" },
  group: { borderRadius: settingsLayout.groupRadius, overflow: "hidden" },
  groupFooter: { paddingHorizontal: settingsLayout.rowInset, paddingTop: space.s },
  tile: { alignItems: "center", justifyContent: "center" },
  label: { flexDirection: "row", alignItems: "center", gap: settingsLayout.labelGap, flexShrink: 1, flexGrow: 1 },
  labelText: { flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: space.s, minHeight: settingsLayout.rowMinHeight, paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.s },
  value: { flexShrink: 0, maxWidth: "55%", textAlign: "right" },
  empty: { alignItems: "center", gap: space.s, paddingTop: space.huge * 2, paddingHorizontal: space.xxl },
  centered: { textAlign: "center" },
});
