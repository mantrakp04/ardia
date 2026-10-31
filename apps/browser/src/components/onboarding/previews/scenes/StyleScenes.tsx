import { Animated, View, type ViewStyle } from "react-native";
import { GlassFill, Surface } from "../../../ui";
import { hex } from "../../../ui/theme";
import { ink } from "../../../ui/tokens";
import { at, fill, type Geo } from "../geometry";
import { tab } from "../content";
import type { Look } from "../look";
import { tracker } from "../timeline";
import { Backdrop, Favicon, Glyph, Label } from "../Kit";
import { Cursor, Pill } from "../Floating";
import { sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { Std } from "./SceneParts";

const LENS = { x: 120, y: 92, w: 620, h: 360, pad: 28, radius: 34 } as const;
const TILE = { h: 108, gap: 16, radius: 22, icon: 40 } as const;
const FIELD = { top: 152, h: 82, radius: 22 } as const;
const ROW_TOP = 256;
const TILE_W = (LENS.w - LENS.pad * 2 - TILE.gap * 2) / 3;
const HOVER_AT = 760;

type TileState = "rest" | "lit" | "active";

function Face({ g, look, glass, state, radius }: { g: Geo; look: Look; glass: boolean; state: TileState; radius: number }) {
  if (glass) return <GlassFill radius={radius * g.s} state={state} dark={look.dark} theme={look.t} />;
  const active = state === "active";
  return (
    <View
      style={[
        fill,
        {
          borderRadius: radius * g.s,
          borderWidth: 1,
          borderColor: active ? look.t.pinnedSelectedOutline : look.t.pinnedRestingStroke,
          backgroundColor: active ? look.t.pinnedSelectedFill : state === "lit" ? look.t.tabHover : look.t.pinnedResting,
        },
      ]}
    />
  );
}

function Tile({ g, look, glass, i, state, lit }: { g: Geo; look: Look; glass: boolean; i: number; state: TileState; lit?: Animated.AnimatedInterpolation<number> }) {
  return (
    <View style={at(g, LENS.pad + i * (TILE_W + TILE.gap), LENS.pad, TILE_W, TILE.h)}>
      <Face g={g} look={look} glass={glass} state={state} radius={TILE.radius} />
      {lit ? (
        <Animated.View style={[fill, { opacity: lit }]}>
          <Face g={g} look={look} glass={glass} state="lit" radius={TILE.radius} />
        </Animated.View>
      ) : null}
      <View style={[fill, { alignItems: "center", justifyContent: "center" }]}>
        <Favicon g={g} t={tab(i + 1)} size={TILE.icon} />
      </View>
    </View>
  );
}

export function interfaceStyle(glass: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.style);
    const s = g.s;
    const tileCenter = LENS.x + LENS.pad + TILE_W * 1.5 + TILE.gap;
    return (
      <>
        <Std g={g} look={look} opts={opts} />
        <Animated.View
          style={[
            at(g, LENS.x, LENS.y, LENS.w, LENS.h),
            { opacity: t.in(60, 260), transform: [{ scale: t([[60, 0.94], [420, 1]]) }] } as ViewStyle,
          ]}
        >
          <Surface
            fill={hex(look.tint[0])}
            cornerRadius={LENS.radius * s}
            borderColor={hex(look.t.panelBorder)}
            borderWidth={0.5}
            shadowColor={ink.black}
            shadowOpacity={look.dark ? 0.5 : 0.18}
            shadowRadius={18 * s}
            shadowOffset={[0, 6 * s]}
            style={fill}
          />
          <View style={[fill, { borderRadius: LENS.radius * s, overflow: "hidden" }]}>
            <Backdrop g={g} look={look} />
            <Tile g={g} look={look} glass={glass} i={0} state="active" />
            <Tile g={g} look={look} glass={glass} i={1} state="rest" lit={t.in(HOVER_AT, 160)} />
            <Tile g={g} look={look} glass={glass} i={2} state="rest" />
            <View style={[at(g, LENS.pad, FIELD.top, LENS.w - LENS.pad * 2, FIELD.h), { flexDirection: "row", alignItems: "center", gap: 16 * s, paddingHorizontal: 26 * s }]}>
              <Face g={g} look={look} glass={glass} state="rest" radius={FIELD.radius} />
              <Favicon g={g} t={tab(0)} size={28} />
              <Label g={g} size={26} color={look.t.textPrimary} weight="500">
                {tab(0).host}
              </Label>
            </View>
            <View style={[at(g, LENS.pad + 20, ROW_TOP, LENS.w - LENS.pad * 2 - 40, 64), { flexDirection: "row", alignItems: "center", gap: 16 * s }]}>
              <Favicon g={g} t={tab(4)} size={28} />
              <Label g={g} size={26} color={look.t.textSecondary}>
                {tab(4).title}
              </Label>
            </View>
          </View>
        </Animated.View>
        <Cursor g={g} style={{ opacity: t.in(380, 160), transform: [{ translateX: t([[380, (tileCenter + 120) * s], [HOVER_AT, tileCenter * s]]) }, { translateY: t([[380, (LENS.y + LENS.h - 40) * s], [HOVER_AT, (LENS.y + LENS.pad + TILE.h / 2) * s]]) }] }} />
        <Pill g={g} look={look} style={{ left: 16 * s, bottom: 16 * s, opacity: t.in(520, 220), transform: [{ translateY: t([[520, 6 * s], [800, 0]]) }] }}>
          <Glyph g={g} name={glass ? "sparkles" : "square.on.square"} size={13} color={look.t.textPrimary} weight="medium" box={18} />
          <Label g={g} size={13} color={look.t.textPrimary} weight="500">
            {glass ? "Liquid Glass" : "Classic"}
          </Label>
        </Pill>
      </>
    );
  };
}
