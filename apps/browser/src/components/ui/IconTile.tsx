import type { ReactNode } from "react";
import { View } from "react-native";
import { Symbol } from "./native";
import { useTheme } from "./theme";
import { radius } from "./tokens";

const TILE = { s: { box: 26, glyph: 13 }, m: { box: 28, glyph: 13 }, l: { box: 36, glyph: 18 } } as const;

export function IconTile({ symbol, children, size = "m", fill, glyph }: { symbol?: string; children?: ReactNode; size?: keyof typeof TILE; fill?: string; glyph?: string }) {
  const theme = useTheme();
  const tile = TILE[size];
  return (
    <View style={{ width: tile.box, height: tile.box, borderRadius: radius.tile, backgroundColor: fill ?? theme.promptFill, alignItems: "center", justifyContent: "center" }}>
      {symbol ? <Symbol name={symbol} size={tile.glyph} color={glyph ?? theme.icon} style={{ width: tile.box, height: tile.box }} /> : children}
    </View>
  );
}
