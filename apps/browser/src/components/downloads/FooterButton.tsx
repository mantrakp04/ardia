import { Animated, Pressable, View } from "react-native";
import { GlassFill, menuRowFill, PANEL, Symbol, Text, useGlass, useHover, useTheme } from "../ui";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";
import { DOWNLOADS_LIST } from "./tokens";

export function FooterButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const glass = useGlass();
  const { hovered, hoverProps } = useHover();
  const pressMotion = usePressScaleMotion(true, buttonMotion.controlPressScale);
  const scaleStyle = pressMotion.scale ? { transform: [{ scale: pressMotion.scale }] } : undefined;
  return (
    <View {...hoverProps} style={{ paddingHorizontal: PANEL.rowInset }}>
      <Pressable onPress={onPress} onPressIn={pressMotion.onPressIn} onPressOut={pressMotion.onPressOut}>
        {({ pressed }) => (
          <Animated.View
            style={[{
              height: PANEL.rowHeight,
              paddingHorizontal: PANEL.rowPadding,
              borderRadius: PANEL.rowRadius,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: glass || !(hovered || pressed) ? undefined : menuRowFill(theme, pressed),
            }, scaleStyle]}
          >
            {glass && (hovered || pressed) ? <GlassFill radius={PANEL.rowRadius} state={pressed ? "pressed" : "lit"} /> : null}
            <Text tone={hovered ? "textPrimary" : "textSecondary"} style={{ flex: 1 }}>
              {title}
            </Text>
            <Symbol
              name="chevron.right"
              size={DOWNLOADS_LIST.chevronSize}
              weight="semibold"
              color={theme.textTertiary}
              style={{ width: DOWNLOADS_LIST.chevronBox, height: DOWNLOADS_LIST.chevronBox, marginRight: -DOWNLOADS_LIST.chevronBearing }}
            />
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}
