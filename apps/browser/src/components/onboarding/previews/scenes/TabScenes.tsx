import { Animated, View } from "react-native";
import { at, atRect, CHIP, CRUMB_X, FIELD, fill, type Geo, LIGHTS_Y, type Rect, ROW, rowY, SIDEBAR_ICONS, sideCard, STRIP_H, TOOLBAR_H, topCard } from "../geometry";
import { NEW_TAB, tab, type Tab, TRIP } from "../content";
import type { Look } from "../look";
import { tracker } from "../timeline";
import { Backdrop, Card, Crumb, Highlight, Lights, NavIcons, Rows, SidebarField, TabRow, Toolbar } from "../Kit";
import { Page } from "../MockPages";
import { sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { listTop, SwapCrumb } from "./SceneParts";

export const TabsSidebar: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, sceneMs.tabs);
  const c = sideCard(g);
  const top = listTop(opts);
  const field = opts.addressInSidebar;
  return (
    <>
      <Backdrop g={g} look={look} />
      <Lights g={g} y={field ? LIGHTS_Y.field : LIGHTS_Y.toolbar} />
      {field ? (
        <>
          <NavIcons g={g} color={look.t.icon} xs={SIDEBAR_ICONS} y={LIGHTS_Y.field} names={["sidebar.left", "chevron.left", "chevron.right"]} />
          <SidebarField g={g} look={look} t={tab(0)}>
            <View />
          </SidebarField>
          <SwapCrumb g={g} look={look} t={t} a={tab(0)} b={tab(2)} ms={660} x={FIELD.x + 12} y={FIELD.y + 8} />
        </>
      ) : null}
      <Highlight g={g} look={look} y={rowY(0, top)} style={{ opacity: t.in(240, 200), transform: [{ translateY: t([[620, 0], [900, 2 * ROW.pitch * g.s]]) }] }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <TabRow
          key={i}
          g={g}
          look={look}
          t={i === 4 ? NEW_TAB : tab(i)}
          y={rowY(i, top)}
          style={{ opacity: t.in(i * 70, 280), transform: [{ translateX: t([[i * 70, -14 * g.s], [i * 70 + 320, 0]]) }] }}
        />
      ))}
      <Card g={g} look={look} rect={c}>
        {field ? null : (
          <>
            <Toolbar g={g} look={look} w={c.w} t={tab(0)} crumb={false} />
            <SwapCrumb g={g} look={look} t={t} a={tab(0)} b={tab(2)} ms={660} x={CRUMB_X} y={12} />
          </>
        )}
        <Animated.View style={[fill, { opacity: t.out(660, 200) }]}>
          <Page g={g} look={look} top={field ? 0 : TOOLBAR_H} />
        </Animated.View>
        <Animated.View style={[fill, { opacity: t.in(700, 280) }]}>
          <Page g={g} look={look} a={TRIP} top={field ? 0 : TOOLBAR_H} />
        </Animated.View>
      </Card>
    </>
  );
};

function TopChip({ g, look, t: tb, x, style }: { g: Geo; look: Look; t: Tab; x: number; style?: object }) {
  return <TabRow g={g} look={look} t={tb} x={x} y={CHIP.top - 1} w={CHIP.w} style={style} />;
}

function SelectedTopTab({ g, look, x, style }: { g: Geo; look: Look; x: number; style?: object }) {
  return <Animated.View style={[at(g, x, 3, CHIP.w, STRIP_H - 3 + 1), { backgroundColor: look.card, borderTopLeftRadius: 10 * g.s, borderTopRightRadius: 10 * g.s }, style]} />;
}

export const TabsTop: Scene = ({ g, look, p }) => {
  const t = tracker(p, sceneMs.tabs);
  const c = topCard(g);
  const step = CHIP.w + CHIP.gap;
  return (
    <>
      <Backdrop g={g} look={look} />
      <Lights g={g} y={LIGHTS_Y.strip} x={20.75} />
      <Card g={g} look={look} rect={c}>
        <Toolbar g={g} look={look} w={c.w} t={tab(0)} crumb={false} icons={[21, 56, 92]} />
        <SwapCrumb g={g} look={look} t={t} a={tab(0)} b={tab(2)} ms={660} x={118} y={12} />
        <Animated.View style={[fill, { opacity: t.out(660, 200) }]}>
          <Page g={g} look={look} top={TOOLBAR_H} />
        </Animated.View>
        <Animated.View style={[fill, { opacity: t.in(700, 280) }]}>
          <Page g={g} look={look} a={TRIP} top={TOOLBAR_H} />
        </Animated.View>
      </Card>
      <SelectedTopTab g={g} look={look} x={CHIP.x} style={{ opacity: t.in(240, 200), transform: [{ translateX: t([[620, 0], [900, 2 * step * g.s]]) }] }} />
      {[0, 1, 2, 3].map((i) => (
        <TopChip key={i} g={g} look={look} t={tab(i)} x={CHIP.x + i * step} style={{ opacity: t.in(i * 70, 280), transform: [{ translateY: t([[i * 70, -8 * g.s], [i * 70 + 320, 0]]) }] }} />
      ))}
    </>
  );
};

export function addressMove(toSidebar: boolean): Scene {
  return ({ g, look, p }) => {
    const t = tracker(p, sceneMs.address);
    const c = sideCard(g);
    const m = toSidebar ? t([[220, 0], [620, 1]]) : t([[220, 1], [620, 0]]);
    const lerp = (a: number, b: number) => m.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
    const bar: Rect = { x: c.x + CRUMB_X - 12, y: c.y + 3.5, w: 320, h: FIELD.h };
    const dx = bar.x - FIELD.x;
    const dy = bar.y - FIELD.y;
    return (
      <>
        <Backdrop g={g} look={look} />
        <Lights g={g} style={{ transform: [{ translateY: lerp(0, (LIGHTS_Y.field - LIGHTS_Y.toolbar) * g.s) }] }} />
        <NavIcons g={g} color={look.t.icon} xs={SIDEBAR_ICONS} y={LIGHTS_Y.field} names={["sidebar.left", "chevron.left", "chevron.right"]} style={{ opacity: lerp(0, 1) }} />
        <Animated.View style={[fill, { transform: [{ translateY: lerp(0, (ROW.topWithField - ROW.top) * g.s) }] }]}>
          <Rows g={g} look={look} n={4} sel={0} />
        </Animated.View>
        <Card g={g} look={look} rect={c}>
          <Toolbar g={g} look={look} w={c.w} t={tab(0)} crumb={false} style={{ opacity: lerp(1, 0) }} />
          <Animated.View style={[fill, { transform: [{ translateY: lerp(0, -TOOLBAR_H * g.s) }] }]}>
            <Page g={g} look={look} top={TOOLBAR_H} />
          </Animated.View>
        </Card>
        <Animated.View
          style={[
            atRect(g, FIELD),
            {
              borderRadius: 10 * g.s,
              backgroundColor: look.t.pinnedResting,
              opacity: lerp(0, 1),
              transform: [{ translateX: lerp((dx - (FIELD.w * (bar.w / FIELD.w - 1)) / 2 * -1) * g.s, 0) }, { translateY: lerp(dy * g.s, 0) }, { scaleX: lerp(bar.w / FIELD.w, 1) }],
            },
          ]}
        />
        {[300, FIELD.w - 24].map((w, i) => (
          <Crumb
            key={w}
            g={g}
            look={look}
            t={tab(0)}
            style={[
              at(g, FIELD.x + 12, FIELD.y + 8, w, 18),
              { opacity: m.interpolate({ inputRange: [0, 0.45, 0.55, 1], outputRange: i ? [0, 0, 1, 1] : [1, 1, 0, 0] }), transform: [{ translateX: lerp((c.x + CRUMB_X - FIELD.x - 12) * g.s, 0) }, { translateY: lerp((c.y + 12 - FIELD.y - 8) * g.s, 0) }] },
            ]}
          />
        ))}
      </>
    );
  };
}
