import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { ToolbarPalette } from "../layout/toolbarColors";

const LIGHT_STRIPES = require("../../../assets/developer-stripes-light.png");
const DARK_STRIPES = require("../../../assets/developer-stripes-dark.png");

const onDarkBar = (palette: ToolbarPalette) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(palette.text);
  if (!m) return true;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => parseInt(h, 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 128;
};

export const DeveloperStripes = memo(function DeveloperStripes({ palette }: { palette: ToolbarPalette }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <Image source={onDarkBar(palette) ? LIGHT_STRIPES : DARK_STRIPES} style={{ position: "absolute", left: 0, top: 0, width: 2560, height: 50 }} />
    </View>
  );
});
