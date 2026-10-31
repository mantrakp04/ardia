import { Pressable, View } from "react-native";
import { GlassFill, PANEL, Symbol, Text, useGlass, useHover, useTheme } from "../ui";
import { DOWNLOADS_LIST, downloadsRowFill } from "./tokens";

export function FooterButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const glass = useGlass();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ paddingHorizontal: PANEL.rowInset }}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: PANEL.rowHeight,
              paddingHorizontal: PANEL.rowPadding,
              borderRadius: PANEL.rowRadius,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: glass ? undefined : downloadsRowFill(theme, hovered, pressed),
            }}
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
          </View>
        )}
      </Pressable>
    </View>
  );
}
