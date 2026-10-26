import type { ReactNode } from "react";
import { Animated, View } from "react-native";
import { Surface } from "../../../ui";
import { at, fill, type Geo, hairline, sideCard, TOOLBAR_H } from "../geometry";
import { type Look, pick } from "../look";
import { tracker } from "../timeline";
import { Glyph, Label } from "../Kit";
import { Page } from "../MockPages";
import { mockInk, sceneMs } from "../tokens";
import { hex } from "../../../ui/theme";
import { ink } from "../../../ui/tokens";
import type { Scene } from "../scene";
import { Std } from "./SceneParts";

function AdBox({ g, look, style, h, children }: { g: Geo; look: Look; style?: object; h: number; children?: ReactNode }) {
  return (
    <Animated.View style={[{ height: h * g.s, borderRadius: 8 * g.s, backgroundColor: pick(look, [mockInk.ad.fill.light, mockInk.ad.fill.dark]), borderWidth: hairline, borderColor: pick(look, [mockInk.ad.border.light, mockInk.ad.border.dark]), alignItems: "center", justifyContent: "center" }, style]}>
      <Label g={g} size={10} color={pick(look, [mockInk.ad.label.light, mockInk.ad.label.dark])} weight="600">
        AD
      </Label>
      {children}
    </Animated.View>
  );
}

export function block(on: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.block);
    const c = sideCard(g);
    const ad = (ms: number, gone: number) => ({
      opacity: on ? t([[ms, 0], [ms + 200, 1], [gone, 1], [gone + 220, 0]]) : t.in(ms, 200),
      transform: [{ scale: on ? t([[ms, 0.94], [ms + 260, 1], [gone, 1], [gone + 260, 0.86]]) : t([[ms, 0.94], [ms + 260, 1]]) }],
    });
    const field = opts.addressInSidebar;
    const toolbarOpts = { ...opts, addressInSidebar: false };
    return (
      <Std
        g={g}
        look={look}
        opts={field ? toolbarOpts : opts}
        page={
          <Page g={g} look={look} top={TOOLBAR_H}>
            <AdBox g={g} look={look} h={64} style={ad(200, 900)} />
          </Page>
        }
        card={
          <>
            <AdBox g={g} look={look} h={150} style={[at(g, c.w - 150, TOOLBAR_H + 80, 130, 150), ad(120, 820)]} />
            <Animated.View
              style={[
                { position: "absolute", left: 20 * g.s, right: 20 * g.s, bottom: 18 * g.s },
                {
                  opacity: on ? t([[280, 0], [420, 1], [980, 1], [1220, 0]]) : t.in(280, 160),
                  transform: [{ translateY: on ? t([[280, 40 * g.s], [580, 0], [980, 0], [1220, 40 * g.s]]) : t([[280, 40 * g.s], [580, 0]]) }],
                },
              ]}
            >
              <Surface fill={hex(look.t.panel)} cornerRadius={12 * g.s} borderColor={hex(look.t.panelBorder)} borderWidth={0.5} shadowColor={ink.black} shadowOpacity={look.dark ? 0.5 : 0.14} shadowRadius={16 * g.s} shadowOffset={[0, 4 * g.s]} style={{ height: 52 * g.s, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 * g.s, gap: 12 * g.s }}>
                <View style={{ flex: 1 }}>
                  <Label g={g} size={12.5} color={look.t.textPrimary}>
                    We use cookies to personalise ads and measure traffic.
                  </Label>
                </View>
                <View style={{ height: 28 * g.s, paddingHorizontal: 12 * g.s, borderRadius: 8 * g.s, backgroundColor: look.t.goButton, justifyContent: "center" }}>
                  <Label g={g} size={12} color={look.t.onPrimary} weight="600">
                    Accept all
                  </Label>
                </View>
              </Surface>
            </Animated.View>
            {on ? (
              <Animated.View style={[at(g, c.w - 64, 8, 52, 26), { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 * g.s, opacity: t.in(700, 200), transform: [{ scale: t([[700, 0.6], [960, 1]]) }] }]}>
                <Glyph g={g} name="checkmark.shield.fill" size={14} color={look.t.accent} weight="medium" box={18} />
                <Label g={g} size={11} color={look.t.textSecondary} weight="600">
                  3
                </Label>
              </Animated.View>
            ) : null}
          </>
        }
      />
    );
  };
}
