import { View } from "react-native-web";
import type { ViewProps } from "react-native";

export function BriefRail({ text, fontSize, clockwise = false, style }: ViewProps & { text: string; fontSize: number; clockwise?: boolean }) {
  return <View style={[style, { alignItems: "center", justifyContent: "center" }]}><div style={{ color: "#eeeeeb", fontFamily: "Georgia", fontStyle: "italic", fontSize, writingMode: "vertical-rl", transform: clockwise ? undefined : "rotate(180deg)", whiteSpace: "nowrap" }}>{text}</div></View>;
}
