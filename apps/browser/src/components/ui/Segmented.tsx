import { Pressable, StyleSheet, View } from "react-native";
import { Symbol } from "./native";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { concentric, radius, space } from "./tokens";

export type SegmentOption<T extends string> = { value: T; title: string; image?: string };

const INSET = StyleSheet.hairlineWidth * 2;
const SEGMENT = { height: 20, imageWidth: 30, glyph: 11, glyphBox: 14 } as const;

export function Segmented<T extends string>({ options, value, onChange }: { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", borderRadius: radius.control, backgroundColor: theme.control, borderWidth: INSET, borderColor: theme.controlBorder, padding: INSET }}>
      {options.map((o) => {
        const on = o.value === value;
        const ink = on ? theme.onAccent : theme.icon;
        return (
          <Pressable key={o.value} tooltip={o.image ? o.title : undefined} accessibilityRole="button" accessibilityLabel={o.title} accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}>
            <View
              style={{
                width: o.image ? SEGMENT.imageWidth : undefined,
                height: SEGMENT.height,
                paddingHorizontal: o.image ? undefined : space.m,
                borderRadius: concentric(radius.control, INSET),
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? theme.formAccent : undefined,
              }}
            >
              {o.image ? (
                <Symbol name={o.image} size={SEGMENT.glyph} color={ink} style={{ width: SEGMENT.glyphBox, height: SEGMENT.glyphBox }} />
              ) : (
                <Text size="small" color={on ? theme.onAccent : theme.textPrimary}>
                  {o.title}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
