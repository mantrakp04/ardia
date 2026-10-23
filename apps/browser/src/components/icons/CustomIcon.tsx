import { Symbol } from "@ardia/shell";
import { Image, View, type ImageSourcePropType } from "react-native";
import { ATLAS_COLUMNS, ATLAS_ROWS, iconIndex, parseCustomIcon } from "../../lib/iconCatalog";
import { duotoneColors, type IconBackground } from "../../lib/iconColors";
import { PROFILE_COLORS, useTheme } from "../../lib/theme";

const LUCIDE = require("../../../assets/sidebar-icons/lucide.png");
const DUOTONE_FILL = require("../../../assets/sidebar-icons/duotone-fill.png");
const DUOTONE_STROKE = require("../../../assets/sidebar-icons/duotone-stroke.png");

export function CustomIcon({ value, size, glyphSize = size, color, background, weight = "regular" }: {
  value: string;
  size: number;
  glyphSize?: number;
  color?: string;
  background?: IconBackground;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
}) {
  const theme = useTheme();
  const icon = parseCustomIcon(value);
  if (!icon || icon.style === "symbols") {
    return <Symbol name={icon?.name ?? "questionmark.circle"} size={glyphSize} weight={weight} color={icon?.color ?? color ?? theme.icon} style={{ width: size, height: size }} />;
  }
  const index = iconIndex(icon.name);
  const tint = icon.color ?? color;
  const palette = tint ? [tint] : theme.custom && theme.powerUpPalette?.length
    ? theme.powerUpPalette
    : [theme.profileColor === "incognito" ? theme.icon : PROFILE_COLORS[theme.profileColor].swatch];
  const tones = icon.style === "duotone" ? duotoneColors(palette, background ?? theme.panel, theme.dark) : null;
  return (
    <View accessible={false} pointerEvents="none" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: glyphSize, height: glyphSize, overflow: "hidden" }}>
        {icon.style === "lucide" ? (
          <AtlasGlyph source={LUCIDE} index={index} size={glyphSize} color={icon.color ?? color ?? theme.icon} />
        ) : (
          <>
            <AtlasGlyph source={DUOTONE_FILL} index={index} size={glyphSize} color={tones!.fill} opacity={0.28} />
            <AtlasGlyph source={DUOTONE_STROKE} index={index} size={glyphSize} color={tones!.foreground} />
          </>
        )}
      </View>
    </View>
  );
}

function AtlasGlyph({ source, index, size, color, opacity = 1 }: { source: ImageSourcePropType; index: number; size: number; color: string; opacity?: number }) {
  return (
    <Image
      accessible={false}
      source={source}
      resizeMode="stretch"
      style={{
        position: "absolute",
        width: size * ATLAS_COLUMNS,
        height: size * ATLAS_ROWS,
        left: -(index % ATLAS_COLUMNS) * size,
        top: -Math.floor(index / ATLAS_COLUMNS) * size,
        tintColor: color,
        opacity,
      }}
    />
  );
}
