import { Children, createContext, isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { settingsSectionKey, useSettingsSearch } from "../../state/settings/searchState";
import { registerAnchor } from "./anchors";
import { useProfiles, useSettings, useTabLayout } from "../../state/browser/hooks";
import { currentSettings } from "../../state/browser/current";
import type { SettingsPane } from "../../state/settings/settingsWindows";
import { curve } from "../ui/motion";
import { Group as PlainGroup, Row as PlainRow } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { lineHeight, proseLineHeight, radius as radii, space } from "../ui/tokens";
import { findSetting, sectionEntries, setting, unshownSettings, type SettingEntry, type SettingId } from "./settingsIndex";
import { Toggle } from "../ui/Switch";
import { liquidGlass } from "../ui/Glass";
import { PopUp } from "../ui/Field";
import { Text } from "../ui/Text";
import { updateSettings } from "../../state/settings/actions";
import type { Settings } from "../../state/settings/settings";
import { settingsMotion } from "./tokens";

export const SettingsPaneContext = createContext<SettingsPane | null>(null);

export function useUnshownSettings(): ReadonlySet<string> {
  const top = useTabLayout() === "top";
  const ids = useSettings((s) => unshownSettings(s, { top, glass: liquidGlass }));
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}

export function useHiddenSetting() {
  const shown = useSettings((s) => s.showAdvancedSettings);
  const revealed = useSettingsSearch((s) => s.revealedSections);
  const unshown = useUnshownSettings();
  return (entry: SettingEntry | undefined) =>
    !!entry && (unshown.has(entry.id) || (entry.advanced && !shown && !revealed.includes(settingsSectionKey(entry.pane, entry.section))));
}

function useHiddenSection(pane: SettingsPane | null | undefined, section: string | undefined) {
  const hidden = useHiddenSetting();
  if (!pane || !section) return false;
  const entries = sectionEntries(pane, section);
  return entries.length > 0 && entries.every(hidden);
}

export function Group({ children, of }: { children: ReactNode; of?: SettingId }) {
  const hidden = useHiddenSetting();
  if (of && hidden(findSetting(of))) return null;
  const rows = Children.toArray(children).filter(
    (child) => !(isValidElement<{ anchor?: unknown }>(child) && typeof child.props.anchor === "string" && hidden(findSetting(child.props.anchor))),
  );
  if (!rows.length) return null;
  return <PlainGroup>{rows}</PlainGroup>;
}

export type AnchorShape = "row" | "card";

const ANCHOR_RADIUS: Record<AnchorShape, number> = { row: radii.control, card: radii.panel };

export function Anchor({ id, children, shape, style, keep }: { id?: SettingId; children: ReactNode; shape?: AnchorShape; style?: StyleProp<ViewStyle>; keep?: boolean }) {
  const hidden = useHiddenSetting();
  if (!keep && id && hidden(findSetting(id))) return null;
  return (
    <ShownAnchor id={id} radius={shape ? ANCHOR_RADIUS[shape] : 0} style={style}>
      {children}
    </ShownAnchor>
  );
}

function ShownAnchor({ id, children, radius, style }: { id?: SettingId; children: ReactNode; radius: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const flash = useSettingsSearch((s) => (id && s.flash?.id === id ? s.flash.at : 0));
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => (id && ref.current ? registerAnchor(id, ref.current) : undefined), [id]);
  useEffect(() => {
    if (!flash) return;
    glow.setValue(0);
    const run = Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: settingsMotion.searchFlashIn, easing: curve.enter, useNativeDriver: true }),
      Animated.delay(settingsMotion.searchFlashHold),
      Animated.timing(glow, { toValue: 0, duration: settingsMotion.searchFlashOut, easing: curve.move, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [flash]);
  if (!id) return <View style={style}>{children}</View>;
  return (
    <View ref={ref} collapsable={false} style={style}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: theme.searchFlash, opacity: glow }]} />
      {children}
    </View>
  );
}

export function SectionHeader({ title, description, action, anchor }: { title?: string; description?: string | null; action?: ReactNode; anchor?: SettingId }) {
  const pane = useContext(SettingsPaneContext);
  const entry = anchor ? setting(anchor) : undefined;
  const text = title ?? entry?.section ?? "";
  const detail = description === undefined ? entry?.description : description;
  if (useHiddenSection(entry?.pane ?? pane, entry?.section ?? title)) return null;
  return (
    <Anchor id={anchor} keep shape="row" style={SECTION_HEADER}>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{text}</Text>
        {detail ? (
          <Text size="small" tone="textSecondary" style={SECTION_DETAIL}>
            {detail}
          </Text>
        ) : null}
      </View>
      {action}
    </Anchor>
  );
}

export function Row({
  title,
  description,
  children,
  icon,
  onPress,
  anchor,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  onPress?: () => void;
  anchor?: SettingId;
}) {
  const entry = anchor ? setting(anchor) : undefined;
  const row = (
    <PlainRow title={title ?? entry?.title} description={description === undefined ? entry?.description : description} icon={icon} onPress={onPress}>
      {children}
    </PlainRow>
  );
  return anchor ? <Anchor id={anchor}>{row}</Anchor> : row;
}

type BooleanSettingKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

export function SettingToggle({ anchor, description }: { anchor: SettingId & `${string}.${BooleanSettingKey}`; description?: ReactNode }) {
  const key = anchor.slice(anchor.indexOf(".") + 1) as BooleanSettingKey;
  const value = useSettings((s) => s[key]);
  return (
    <Row anchor={anchor} description={description}>
      <Toggle value={value} onChange={(on) => updateSettings({ [key]: on })} />
    </Row>
  );
}

export const useSettingsProfile = (initial?: string | null) => useState(() => initial ?? currentSettings().defaultProfileId);

export function ProfilePicker({ value, onChange }: { value: string; onChange: (profileId: string) => void }) {
  const profiles = useProfiles();
  if (profiles.length < 2) return null;
  return <PopUp value={value} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={onChange} />;
}

const SECTION_HEADER = { flexDirection: "row", alignItems: "flex-end", marginTop: space.xxxl, marginBottom: space.m, paddingHorizontal: space.xxs } as const;
const SECTION_DETAIL = { marginTop: space.xs, lineHeight: lineHeight.body } as const;

export function PaneIntro({ children }: { children: ReactNode }) {
  return (
    <Text size="small" tone="textSecondary" style={PANE_INTRO}>
      {children}
    </Text>
  );
}

const PANE_INTRO = { marginTop: space.xxl, lineHeight: proseLineHeight.small } as const;

export function FormField({ label, inline, children }: { label: string; inline?: boolean; children: ReactNode }) {
  return (
    <View style={inline ? FIELD_INLINE : FIELD}>
      <Text size="caption" tone="textSecondary" style={inline ? undefined : FIELD_LABEL}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const FIELD = { marginTop: space.l } as const;
const FIELD_INLINE = { marginTop: space.l, flexDirection: "row", alignItems: "center", gap: space.ml } as const;
const FIELD_LABEL = { marginBottom: space.xs } as const;
