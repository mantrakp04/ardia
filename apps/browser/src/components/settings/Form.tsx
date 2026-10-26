import { useEffect, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { registerAnchor, useSettingsSearch } from "../../state/settings/searchState";
import { curve } from "../ui/motion";
import { Row as PlainRow } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { font, space, weight } from "../ui/tokens";
import { setting } from "./settingsIndex";
import { settingsMotion } from "./tokens";

export function Anchor({ id, children, radius = 0, style }: { id?: string; children: ReactNode; radius?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const flash = useSettingsSearch((s) => (id && s.flash?.id === id ? s.flash.at : 0));
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => (id && ref.current ? registerAnchor(id, ref.current) : undefined), [id]);
  useEffect(() => {
    if (!flash) return;
    glow.setValue(0);
    const run = Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: settingsMotion.searchFlashIn, easing: curve.outQuad, useNativeDriver: true }),
      Animated.delay(settingsMotion.searchFlashHold),
      Animated.timing(glow, { toValue: 0, duration: settingsMotion.searchFlashOut, easing: curve.inOutQuad, useNativeDriver: true }),
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

export function SectionHeader({ title, description, action, anchor }: { title?: string; description?: string; action?: ReactNode; anchor?: string }) {
  const theme = useTheme();
  const entry = anchor ? setting(anchor) : undefined;
  const text = title ?? entry?.section ?? "";
  return (
    <Anchor id={anchor} radius={6} style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 22, marginBottom: space.m, paddingHorizontal: space.xxs }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...font.body, fontWeight: weight.semibold, color: theme.textPrimary }}>{text}</Text>
        {description ? <Text style={{ ...font.small, marginTop: 3, color: theme.textSecondary, lineHeight: 16 }}>{description}</Text> : null}
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
  anchor?: string;
}) {
  const entry = anchor ? setting(anchor) : undefined;
  const row = (
    <PlainRow title={title ?? entry?.title} description={description === undefined ? entry?.description : description} icon={icon} onPress={onPress}>
      {children}
    </PlainRow>
  );
  return anchor ? <Anchor id={anchor}>{row}</Anchor> : row;
}
