import { forwardRef, type ReactNode } from "react";
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Bands } from "./Bands";
import { colorOrUndefined, finite, type AnyProps } from "./shared";

const SHEEN_REACH = 0.6;
const SOFT_LIGHT_RING = "rgba(255,255,255,0.4)";
const BLURRED_RING = { light: "rgba(0,0,0,0.12)", dark: "rgba(255,255,255,0.3)" };

function TemplateIcon({ image, emoji, size }: { image?: string; emoji?: string; size: number }) {
  if (!image && !emoji) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      {image ? (
        <Image source={{ uri: image }} style={{ width: size, height: size }} resizeMode="contain" />
      ) : (
        <Text allowFontScaling={false} style={{ fontSize: size * 0.85, lineHeight: size, textAlign: "center" }}>
          {emoji}
        </Text>
      )}
    </View>
  );
}

export const DockSelection = forwardRef<View, AnyProps>(function DockSelection(
  { image, emoji, theme, fill, stroke, cornerRadius, strokeWidth, iconSize, dark, glass, colorRing, style, children, ...rest },
  ref,
) {
  const isDark = dark !== false;
  const radius = Math.max(0, finite(cornerRadius, 10));
  const width = Math.max(0, Math.round(finite(strokeWidth, 3) * 2) / 2);
  const kind = theme === "blur" || theme === "template" ? theme : "";
  const fillColor = colorOrUndefined(fill);
  const strokeColor = colorOrUndefined(stroke);
  const ringColor = strokeColor ?? (kind === "blur" ? BLURRED_RING[isDark ? "dark" : "light"] : SOFT_LIGHT_RING);
  const shape: ViewStyle = { ...StyleSheet.absoluteFillObject, borderRadius: radius };
  let layers: ReactNode;
  if (glass === true) {
    const rimTop = `rgba(255,255,255,${isDark ? 0.5 : 1})`;
    const rimBottom = `rgba(255,255,255,${isDark ? 0.14 : 0.55})`;
    const rimSide = `rgba(255,255,255,${isDark ? 0.32 : 0.78})`;
    layers = (
      <>
        <View
          style={[
            shape,
            { overflow: "hidden" },
            colorRing === true ? null : { shadowColor: "#000000", shadowOpacity: isDark ? 0.5 : 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
          ]}
        >
          {kind === "template" && fillColor ? <View style={[StyleSheet.absoluteFill, { backgroundColor: fillColor, opacity: isDark ? 0.35 : 0.3 }]} /> : null}
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${SHEEN_REACH * 100}%` }}>
            <Bands stops={[[1, 1, 1, isDark ? 0.12 : 0.4], [1, 1, 1, 0]]} count={8} />
          </View>
        </View>
        {width > 0 ? (
          <View
            style={[
              shape,
              colorRing === true
                ? { borderWidth: width, borderColor: ringColor }
                : { borderWidth: width, borderTopColor: rimTop, borderLeftColor: rimSide, borderRightColor: rimSide, borderBottomColor: rimBottom },
            ]}
          />
        ) : null}
      </>
    );
  } else {
    const tileColor = kind === "blur" ? `rgba(255,255,255,${isDark ? 0.2 : 1})` : fillColor;
    layers = (
      <>
        <View style={[shape, { backgroundColor: tileColor }]} />
        {kind === "template" ? <TemplateIcon image={typeof image === "string" ? image : undefined} emoji={typeof emoji === "string" ? emoji : undefined} size={Math.max(1, finite(iconSize, 16))} /> : null}
        {width > 0 ? <View style={[shape, { borderWidth: width, borderColor: ringColor }]} /> : null}
      </>
    );
  }
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={style as ViewStyle}>
      {layers}
      {children as ReactNode}
    </View>
  );
});
