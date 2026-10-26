import type { ReactNode } from "react";
import { Animated, View } from "react-native";
import { at, atRect, fill, type Geo, hairline, type Rect, rowY, TOOLBAR_H } from "../geometry";
import { NOTES, tab, TRIP } from "../content";
import { type Look, pick } from "../look";
import { linear, tracker } from "../timeline";
import { Crumb, Highlight, Label, Lights } from "../Kit";
import { Page } from "../MockPages";
import { Cursor } from "../Floating";
import { mockInk, sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { Desktop, MINI_SIDE, MiniArdia, Window } from "./SceneParts";

function Bubble({ g, look, mine, children, style }: { g: Geo; look: Look; mine?: boolean; children: ReactNode; style?: object }) {
  return (
    <Animated.View style={[{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", borderRadius: 16 * g.s, paddingHorizontal: 12 * g.s, paddingVertical: 7 * g.s, backgroundColor: mine ? mockInk.bubbleMine : pick(look, [mockInk.bubble.light, mockInk.bubble.dark]) }, style]}>
      {typeof children === "string" ? (
        <Label g={g} size={12.5} color={mine ? mockInk.bubbleMineText : look.t.textPrimary} lines={3}>
          {children}
        </Label>
      ) : (
        children
      )}
    </Animated.View>
  );
}

export function links(little: boolean): Scene {
  return ({ g, look, p }) => {
    const t = tracker(p, sceneMs.links);
    const chat: Rect = { x: 18, y: 40, w: 300, h: g.H - 80 };
    const ardia: Rect = { x: 300, y: 22, w: g.W - 318, h: g.H - 44 };
    const cursorFrom = { x: chat.x + 250, y: chat.y + chat.h - 40 };
    const cursorTo = { x: chat.x + 120, y: chat.y + 228 };
    const float: Rect = { x: ardia.x + 70, y: 70, w: 430, h: g.H - 120 };
    const arrived = { opacity: t.in(560, 240), transform: [{ translateX: t([[560, -12 * g.s], [860, 0]]) }] };
    return (
      <>
        <Desktop g={g} look={look} />
        <MiniArdia
          g={g}
          look={look}
          rect={ardia}
          tabs={little ? [tab(1), tab(3), tab(4)] : [tab(1), tab(3), tab(4), tab(0)]}
          sel={little ? 0 : 3}
          rowStyle={(i) => (!little && i === 3 ? arrived : null)}
          extra={little ? null : <Highlight g={g} look={look} y={rowY(0)} w={MINI_SIDE - 12} style={{ opacity: t.out(560, 200) }} />}
          cardContent={
            little ? (
              <Page g={g} look={look} a={TRIP} top={TOOLBAR_H} />
            ) : (
              <>
                <Page g={g} look={look} a={TRIP} top={TOOLBAR_H} />
                <Animated.View style={[fill, { opacity: t.in(640, 300) }]}>
                  <Page g={g} look={look} top={TOOLBAR_H} />
                </Animated.View>
              </>
            )
          }
        />
        <Window g={g} look={look} rect={chat}>
          <View style={[fill, { backgroundColor: pick(look, [mockInk.chat.light, mockInk.chat.dark]) }]} />
          <Lights g={g} y={20} x={20} />
          <View style={[at(g, 0, 38, chat.w, 1), { height: hairline, backgroundColor: look.t.divider }]} />
          <Label g={g} size={13} color={look.t.textPrimary} weight="600" style={{ position: "absolute", top: 13 * g.s, left: 0, right: 0, textAlign: "center" }}>
            Sam
          </Label>
          <View style={{ position: "absolute", left: 14 * g.s, right: 14 * g.s, top: 54 * g.s, gap: 8 * g.s }}>
            <Bubble g={g} look={look}>Found the trail we talked about</Bubble>
            <Bubble g={g} look={look} mine>
              Send it!
            </Bubble>
            <Bubble g={g} look={look} style={{ padding: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden", width: 210 * g.s }}>
              <View style={{ height: 70 * g.s, backgroundColor: NOTES.hero.far[look.dark ? 1 : 0] }}>
                <View style={{ position: "absolute", left: "30%", right: "-20%", top: 28 * g.s, height: 120 * g.s, borderRadius: 80 * g.s, backgroundColor: NOTES.hero.near[look.dark ? 1 : 0] }} />
              </View>
              <View style={{ padding: 9 * g.s, gap: 2 * g.s }}>
                <Label g={g} size={12} color={look.t.textPrimary} weight="600">
                  A slow morning on the coast trail
                </Label>
                <Label g={g} size={11} color={look.t.textSecondary}>
                  fieldnotes.blog
                </Label>
              </View>
              <Animated.View style={[fill, { backgroundColor: mockInk.pressFlash, opacity: t([[470, 0], [510, 1], [700, 0]], linear) }]} />
            </Bubble>
          </View>
        </Window>
        {little ? (
          <Animated.View style={[atRect(g, float), { opacity: t.in(560, 220), transform: [{ translateY: t([[560, 14 * g.s], [900, 0]]) }, { scale: t([[560, 0.9], [900, 1]]) }] }]}>
            <Window g={g} look={look} rect={{ x: 0, y: 0, w: float.w, h: float.h }}>
              <View style={[fill, { backgroundColor: look.page }]} />
              <View style={[at(g, 0, 0, float.w, 38), { backgroundColor: look.card, borderBottomWidth: hairline, borderColor: look.t.divider }]}>
                <Lights g={g} y={19} x={19} />
                <Crumb g={g} look={look} t={tab(0)} style={at(g, 84, 10, float.w - 100, 18)} />
              </View>
              <Page g={g} look={look} top={38} />
            </Window>
          </Animated.View>
        ) : null}
        <Cursor
          g={g}
          style={{
            opacity: t([[60, 0], [200, 1], [1150, 1], [1400, 0]]),
            transform: [
              { translateX: t([[60, cursorFrom.x * g.s], [440, cursorTo.x * g.s]]) },
              { translateY: t([[60, cursorFrom.y * g.s], [440, cursorTo.y * g.s]]) },
              { scale: t([[460, 1], [500, 0.85], [620, 1]], linear) },
            ],
          }}
        />
      </>
    );
  };
}
