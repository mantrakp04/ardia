import { View } from "react-native";
import type { Scene } from "../scene";
import { STAGE, StyleStage } from "../StylePreview";

export function interfaceStyle(glass: boolean): Scene {
  return ({ g, look }) => {
    const scale = Math.max((g.W * g.s) / STAGE.width, (g.H * g.s) / STAGE.height);
    return (
      <View style={{ position: "absolute", left: 0, top: 0, width: STAGE.width, height: STAGE.height, transform: [{ translateX: (STAGE.width * (scale - 1)) / 2 }, { translateY: (STAGE.height * (scale - 1)) / 2 }, { scale }] }}>
        <StyleStage look={look} choice={{ glass, tint: 0 }} />
      </View>
    );
  };
}
