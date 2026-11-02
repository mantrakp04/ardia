import { Fragment, useContext } from "react";
import { Animated, View } from "react-native";
import { Surface } from "../ui";
import { useTheme } from "../ui/theme";
import type { useEasedColor } from "../ui/toolbarColors";
import { FloatingStrip } from "./context";
import { CHIP_HAIRLINE, FLARE, ITEM_HEIGHT, ITEM_TOP, RIM_HEIGHT, RIM_WIDTH, STRIP_COLORS, TAB_RADIUS, TAB_TOP, TOP_STRIP_HEIGHT } from "./tokens";

export type Fill = string | ReturnType<typeof useEasedColor>;

export function SelectedTab({ width, band, opaque = false }: { width: number; band: Fill | null; opaque?: boolean }) {
  const theme = useTheme();
  const floating = useContext(FloatingStrip);
  if (floating) {
    const card = {
      position: "absolute" as const,
      left: 0,
      top: ITEM_TOP,
      width,
      height: ITEM_HEIGHT,
      borderRadius: TAB_RADIUS,
    };
    return (
      <>
        {opaque && <View pointerEvents="none" style={{ ...card, backgroundColor: theme.windowTint[0] }} />}
        <View
          pointerEvents="none"
          style={{
            ...card,
            borderWidth: CHIP_HAIRLINE,
            borderColor: STRIP_COLORS[theme.dark ? "dark" : "light"].floatingTabBorder,
            backgroundColor: theme.card,
          }}
        />
      </>
    );
  }
  const body = width - 1;
  const fills: Fill[] = [...(opaque ? [theme.windowTint[0]] : []), theme.card, ...(band ? [band] : [])];
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height: TOP_STRIP_HEIGHT }}>
      {fills.map((fill, i) => (
        <Fragment key={i}>
          <Animated.View
            style={{
              position: "absolute",
              left: 0.5,
              top: TAB_TOP,
              width: body,
              height: TOP_STRIP_HEIGHT - TAB_TOP,
              borderTopLeftRadius: TAB_RADIUS,
              borderTopRightRadius: TAB_RADIUS,
              backgroundColor: fill,
            }}
          />
          <Flare x={0.5 - FLARE} side="left" color={fill} />
          <Flare x={0.5 + body} side="right" color={fill} />
        </Fragment>
      ))}
      <Surface
        cornerRadius={TAB_RADIUS + 0.5}
        borderWidth={RIM_WIDTH}
        borderColors={STRIP_COLORS[theme.dark ? "dark" : "light"].selectedRim}
        style={{ position: "absolute", left: 0, top: TAB_TOP - 0.5, width, height: RIM_HEIGHT }}
      />
    </View>
  );
}

function Flare({ x, side, color }: { x: number; side: "left" | "right"; color: Fill }) {
  const outer = FLARE * 2;
  return (
    <View style={{ position: "absolute", left: x, top: TOP_STRIP_HEIGHT - FLARE, width: FLARE, height: FLARE, overflow: "hidden" }}>
      <Animated.View
        style={{
          position: "absolute",
          left: side === "left" ? -outer : FLARE - outer,
          top: -outer,
          width: outer * 2,
          height: outer * 2,
          borderRadius: outer,
          borderWidth: FLARE,
          borderColor: color,
        }}
      />
    </View>
  );
}
