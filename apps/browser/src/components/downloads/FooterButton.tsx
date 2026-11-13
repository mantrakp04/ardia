import { useMemo } from "react";
import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { Pressable, View } from "react-native";
import { GlassFill, menuRowFill, PANEL, Symbol, Text, useGlass, useHover, useTheme } from "../ui";
import { DOWNLOADS_LIST } from "./tokens";

export function FooterButton({ title, onPress }: { title: string; onPress: () => void }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { PANEL, DOWNLOADS_LIST } = useMemo(() => ({ PANEL: scaleMetrics(BASE_INTERFACE_METRICS.PANEL, interfaceScale), DOWNLOADS_LIST: scaleMetrics(BASE_INTERFACE_METRICS.DOWNLOADS_LIST, interfaceScale) }), [interfaceScale]);
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
              backgroundColor: glass || !(hovered || pressed) ? undefined : menuRowFill(theme, pressed),
            }}
          >
            {glass && (hovered || pressed) ? <GlassFill radius={PANEL.rowRadius} state={pressed ? "pressed" : "lit"} /> : null}
            <Text tone={hovered ? "textPrimary" : "textSecondary"} style={{ flex: 1 }}>
              {title}
            </Text>
            <Symbol
              name="chevron.right"
              size={BASE_INTERFACE_METRICS.DOWNLOADS_LIST.chevronSize}
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

const BASE_INTERFACE_METRICS = { PANEL, DOWNLOADS_LIST };
