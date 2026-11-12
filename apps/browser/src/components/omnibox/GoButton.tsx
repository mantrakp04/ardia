import type { Suggestion } from "@ardia/core";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { Symbol, Text, useHover, useTheme } from "../ui";
import { GlassFill, useGlass } from "../ui/Glass";
import { BAR_TYPE, GO_BUTTON } from "./tokens";

export function destinationLabel(s: Suggestion | undefined): string {
  if (s?.kind === "search") return s.engine;
  if (s?.kind === "calc") return "Copy";
  return "Go";
}

export const GoButton = memo(function GoButton({ label, enabled, onPress }: { label: string; enabled: boolean; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const glass = useGlass();
  const tone = !enabled ? "textTertiary" : glass ? "textPrimary" : "onPrimary";
  const text = theme[tone];
  return (
    <View {...hoverProps} style={{ marginLeft: GO_BUTTON.before }}>
      <Pressable onPress={onPress} disabled={!enabled} accessibilityRole="button" accessibilityLabel={label}>
        <View
          style={{
            minWidth: GO_BUTTON.minWidth,
            height: GO_BUTTON.height,
            paddingHorizontal: GO_BUTTON.padX,
            borderRadius: GO_BUTTON.radius,
            backgroundColor: glass ? undefined : enabled ? theme.goButton : theme.goButtonIdle,
            opacity: !glass && enabled && hovered ? GO_BUTTON.hoverOpacity : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: GO_BUTTON.gap,
          }}
        >
          {glass ? <GlassFill radius={GO_BUTTON.radius} state={!enabled ? "rest" : hovered ? "pressed" : "lit"} /> : null}
          <Text lines={1} weight="semibold" tone={tone} style={BAR_TYPE.goLabel}>
            {label}
          </Text>
          <Symbol
            name="return"
            size={GO_BUTTON.glyph}
            weight="medium"
            color={enabled ? text + GO_BUTTON.glyphAlpha : text}
            style={{ width: GO_BUTTON.glyphBox, height: GO_BUTTON.glyphBox }}
          />
        </View>
      </Pressable>
    </View>
  );
});
