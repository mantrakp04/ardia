import { useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export function HoverSlot({
  hovered,
  hover,
  width,
  reserve = "always",
  align = "end",
  children,
  style,
}: {
  hovered: boolean;
  hover: ReactNode;
  width: number | "content";
  reserve?: "always" | "hover";
  align?: "start" | "end";
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [contentWidth, setContentWidth] = useState(0);
  const fitsContent = width === "content";
  const room = fitsContent ? contentWidth : width;
  const hasHover = hover != null && hover !== false;
  const showHover = hovered && hasHover;
  const edge = align === "start" ? { left: 0 } : { right: 0 };
  return (
    <View
      style={[
        { minWidth: reserve === "always" || showHover ? room : 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: align === "start" ? "flex-start" : "flex-end" },
        style,
      ]}
    >
      {children != null && children !== false ? (
        <View pointerEvents={showHover ? "none" : "box-none"} style={{ flexDirection: "row", alignItems: "center", opacity: showHover ? 0 : 1 }}>
          {children}
        </View>
      ) : null}
      {fitsContent && hasHover ? (
        <View
          onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)}
          style={{ position: "absolute", top: 0, bottom: 0, ...edge, flexDirection: "row", alignItems: "center", opacity: showHover ? 1 : 0 }}
        >
          {hover}
        </View>
      ) : showHover ? (
        <View style={{ position: "absolute", top: 0, bottom: 0, ...edge, flexDirection: "row", alignItems: "center" }}>{hover}</View>
      ) : null}
    </View>
  );
}
