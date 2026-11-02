import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Box, Symbol, Text, useHover, useTheme } from "../ui";
import { SelectableCard } from "./SelectableCard";
import { pictureChoice } from "./tokens";

const CHECK = { width: 14, height: 14 } as const;

export function PictureChoice({
  title,
  selected,
  onPress,
  tooltip,
  size,
  children,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
  tooltip?: string;
  size: "m" | "l" | "icon";
  children: ReactNode;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const icon = size === "icon";
  return (
    <View {...hoverProps} style={icon ? { width: pictureChoice.iconWidth } : { flex: 1 }}>
      <Pressable onPress={onPress} tooltip={tooltip}>
        <Box gap="m" style={{ alignItems: "center" }}>
          <SelectableCard
            selected={selected}
            hovered={hovered}
            fill={false}
            radius={icon ? "sheet" : "panel"}
            style={icon ? { width: pictureChoice.icon, height: pictureChoice.icon, alignItems: "center", justifyContent: "center" } : { width: "100%", height: pictureChoice[size], flexDirection: "row" }}
          >
            {children}
          </SelectableCard>
          <Box row gap="xs" style={{ alignItems: "center" }}>
            {selected && <Symbol name="checkmark.circle.fill" size={12} color={theme.formAccent} style={CHECK} />}
            <Text size="small" tone={selected ? "textPrimary" : "textSecondary"} lines={1}>
              {title}
            </Text>
          </Box>
        </Box>
      </Pressable>
    </View>
  );
}
