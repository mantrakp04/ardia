import { Animated, View } from "react-native";
import { CRUMB_X, FIELD, fill, rowY, SIDEBAR_W, sideCard, TOOLBAR_H } from "../geometry";
import { NEW_TAB, tab, TRIP } from "../content";
import { tracker } from "../timeline";
import { Card, SidebarField, TabRow, Toolbar } from "../Kit";
import { Page } from "../MockPages";
import { MockSwitcher, switcherLevels } from "../Switcher";
import { sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { Chrome, listTop, SwapCrumb } from "./SceneParts";

const SWITCH_AT = 520;
const SETTLE = 250;
const FIRST = [0, 1, 3];
const SECOND = [2, 5, 6];

export function switcher(icons: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.switcher);
    const c = sideCard(g);
    const top = listTop(opts);
    const field = opts.addressInSidebar;
    const slide = (SIDEBAR_W / 2) * g.s;
    const level = (i: number, icon: string | null) => {
      const { selected, idle } = switcherLevels(icon);
      if (i === 0) return t([[SWITCH_AT, selected], [SWITCH_AT + SETTLE, idle]]);
      if (i === 1) return t([[SWITCH_AT, idle], [SWITCH_AT + SETTLE, selected]]);
      return idle;
    };
    const rows = (ids: number[]) => (
      <>
        {ids.map((id, i) => (
          <TabRow key={id} g={g} look={look} t={tab(id)} y={rowY(i, top)} selected={i === 0} />
        ))}
        <TabRow g={g} look={look} t={NEW_TAB} y={rowY(ids.length, top)} />
      </>
    );
    return (
      <>
        <Chrome g={g} look={look} opts={opts} />
        {field ? (
          <>
            <SidebarField g={g} look={look} t={tab(0)}>
              <View />
            </SidebarField>
            <SwapCrumb g={g} look={look} t={t} a={tab(0)} b={tab(2)} ms={SWITCH_AT} x={FIELD.x + 12} y={FIELD.y + 8} />
          </>
        ) : null}
        <Animated.View style={[fill, { opacity: t.out(SWITCH_AT, SETTLE), transform: [{ translateX: t([[SWITCH_AT, 0], [SWITCH_AT + SETTLE, -slide]]) }] }]}>
          {rows(FIRST)}
        </Animated.View>
        <Animated.View style={[fill, { opacity: t.in(SWITCH_AT, SETTLE), transform: [{ translateX: t([[SWITCH_AT, slide], [SWITCH_AT + SETTLE, 0]]) }] }]}>
          {rows(SECOND)}
        </Animated.View>
        <MockSwitcher g={g} look={look} icons={icons} level={level} style={{ opacity: t.in(0, 200), transform: [{ translateY: t([[0, 4 * g.s], [260, 0]]) }] }} />
        <Card g={g} look={look} rect={c}>
          {field ? null : (
            <>
              <Toolbar g={g} look={look} w={c.w} t={tab(0)} crumb={false} />
              <SwapCrumb g={g} look={look} t={t} a={tab(0)} b={tab(2)} ms={SWITCH_AT} x={CRUMB_X} y={12} />
            </>
          )}
          <Animated.View style={[fill, { opacity: t.out(SWITCH_AT, SETTLE) }]}>
            <Page g={g} look={look} top={field ? 0 : TOOLBAR_H} />
          </Animated.View>
          <Animated.View style={[fill, { opacity: t.in(SWITCH_AT + 40, SETTLE) }]}>
            <Page g={g} look={look} a={TRIP} top={field ? 0 : TOOLBAR_H} />
          </Animated.View>
        </Card>
      </>
    );
  };
}
