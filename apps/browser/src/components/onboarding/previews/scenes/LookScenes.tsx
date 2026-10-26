import { Animated, View } from "react-native";
import { fill, sideCard, TOOLBAR_H } from "../geometry";
import { tab } from "../content";
import { lookFor } from "../look";
import { tracker } from "../timeline";
import { Glyph, Label, Toolbar } from "../Kit";
import { Page } from "../MockPages";
import { Pill } from "../Floating";
import { mockInk, sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { Std } from "./SceneParts";

export function appearance(mode: "light" | "dark" | "auto"): Scene {
  return ({ g, p, opts }) => {
    const t = tracker(p, sceneMs.appearance);
    const toDark = mode === "auto" ? opts.systemDark : mode === "dark";
    const from = lookFor(!toDark, opts.accent);
    const to = lookFor(toDark, opts.accent);
    const icon = toDark ? "moon.fill" : "sun.max.fill";
    const label = mode === "auto" ? `Auto · ${toDark ? "Dark" : "Light"} like your Mac` : toDark ? "Dark" : "Light";
    return (
      <>
        <View style={fill}>
          <Std g={g} look={from} opts={opts} />
        </View>
        <Animated.View style={[fill, { opacity: t.in(200, 420) }]}>
          <Std g={g} look={to} opts={opts} />
        </Animated.View>
        <Pill g={g} look={to} style={{ left: 16 * g.s, bottom: 16 * g.s, opacity: t.in(420, 220), transform: [{ translateY: t([[420, 6 * g.s], [700, 0]]) }] }}>
          <Animated.View style={{ transform: [{ rotate: t.deg([[460, -90], [900, 0]]) }] }}>
            <Glyph g={g} name={icon} size={14} color={toDark ? mockInk.moon : mockInk.sun} weight="medium" box={18} />
          </Animated.View>
          <Label g={g} size={13} color={to.t.textPrimary} weight="500">
            {label}
          </Label>
        </Pill>
      </>
    );
  };
}

export function siteColor(on: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.siteColor);
    const c = sideCard(g);
    const toolbarOpts = { ...opts, addressInSidebar: false };
    return (
      <Std
        g={g}
        look={look}
        opts={toolbarOpts}
        page={
          <>
            <View style={[fill, { top: TOOLBAR_H * g.s, backgroundColor: look.page }]} />
            <Animated.View style={[fill, { opacity: t.in(80, 320), transform: [{ translateY: t([[80, 6 * g.s], [420, 0]]) }] }]}>
              <Page g={g} look={look} top={TOOLBAR_H} />
            </Animated.View>
          </>
        }
        card={on ? <Toolbar g={g} look={look} w={c.w} t={tab(0)} site style={{ opacity: t.in(560, 380) }} /> : null}
      />
    );
  };
}
