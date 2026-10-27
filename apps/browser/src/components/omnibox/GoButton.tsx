import type { Suggestion } from "@ardia/core";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { Symbol, Text, useHover, useTheme } from "../ui";
import { BAR_TYPE, GO_BUTTON } from "./tokens";

export function destinationLabel(s: Suggestion | undefined): string {
  if (s?.kind === "search") return s.engine;
  if (s?.kind === "calc") return "Copy";
  return "Go";
}

export const GoButton = memo(function GoButton({ label, large, enabled, onPress }: { label: string; large: boolean; enabled: boolean; onPress(): void }) {
  const height = large ? GO_BUTTON.heroHeight : GO_BUTTON.height;
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const text = enabled ? theme.onPrimary : theme.textTertiary;
  return (
    <View {...hoverProps} style={{ marginLeft: GO_BUTTON.before }}>
      <Pressable onPress={onPress} disabled={!enabled} accessibilityRole="button" accessibilityLabel={label}>
        <View
          style={{
            minWidth: large ? GO_BUTTON.heroMinWidth : GO_BUTTON.minWidth,
            height,
            paddingHorizontal: GO_BUTTON.padX,
            borderRadius: height / 2,
            backgroundColor: enabled ? theme.goButton : theme.goButtonIdle,
            opacity: enabled && hovered ? GO_BUTTON.hoverOpacity : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: GO_BUTTON.gap,
          }}
        >
          <Text lines={1} weight="semibold" tone={enabled ? "onPrimary" : "textTertiary"} style={BAR_TYPE.goLabel}>
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
