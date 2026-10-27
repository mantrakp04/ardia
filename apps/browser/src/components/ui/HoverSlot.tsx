import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export function HoverSlot({
  hovered,
  hover,
  width,
  reserve = "always",
  children,
  style,
}: {
  hovered: boolean;
  hover: ReactNode;
  width: number;
  reserve?: "always" | "hover";
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const showHover = hovered && hover != null && hover !== false;
  return (
    <View style={[{ minWidth: reserve === "always" || showHover ? width : 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }, style]}>
      {children != null && children !== false ? (
        <View pointerEvents={showHover ? "none" : "box-none"} style={{ flexDirection: "row", alignItems: "center", opacity: showHover ? 0 : 1 }}>
          {children}
        </View>
      ) : null}
      {showHover ? <View style={{ position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row", alignItems: "center" }}>{hover}</View> : null}
    </View>
  );
}
