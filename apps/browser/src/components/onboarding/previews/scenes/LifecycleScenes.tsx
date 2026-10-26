import { Animated, View } from "react-native";
import { fill, type Rect, ROW, rowY, sideCard, TOOLBAR_H } from "../geometry";
import { BLANK, tab, TRIP } from "../content";
import { linear, tracker } from "../timeline";
import { Backdrop, Card, Glyph, Highlight, Label, NewTabButton, TabRow } from "../Kit";
import { NewTabPage, Page } from "../MockPages";
import { Cursor, Pill } from "../Floating";
import { sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { Chrome, Desktop, KeyPress, listTop, MINI_SIDE, MiniArdia, Std } from "./SceneParts";

export function tidy(auto: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.tidy);
    const c = sideCard(g);
    const list = listTop(opts);
    const old = new Set([1, 3, 4]);
    const gone = auto ? { opacity: t([[850, 1], [1000, 0.4], [1060, 0.4], [1300, 0]]), transform: [{ translateX: t([[1060, 0], [1300, -10 * g.s]]) }, { scaleY: t([[1060, 1], [1300, 0.6]]) }] } : null;
    const rise = (n: number) => (auto && n ? { transform: [{ translateY: t([[1140, 0], [1460, -n * ROW.pitch * g.s]]) }] } : null);
    const above = (i: number) => [...old].filter((o) => o < i).length;
    return (
      <Std
        g={g}
        look={look}
        opts={opts}
        rows={
          <>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <TabRow key={i} g={g} look={look} t={tab(i)} y={rowY(i, list)} selected={i === 0} style={old.has(i) ? gone : rise(above(i))} />
            ))}
            <NewTabButton g={g} look={look} y={rowY(6, list)} style={rise(3)} />
            <Pill g={g} look={look} style={{ right: (g.W - c.x - c.w + 16) * g.s, top: (c.y + 54) * g.s, opacity: t.in(80, 220), transform: [{ translateY: t([[80, -6 * g.s], [360, 0]]) }] }}>
              <Animated.View style={{ transform: [{ rotate: t.deg([[150, 0], [850, 360]]) }] }}>
                <Glyph g={g} name="clock" size={13} color={look.t.textPrimary} weight="medium" box={16} />
              </Animated.View>
              <Label g={g} size={13} color={look.t.textPrimary} weight="500">
                12 hours later
              </Label>
            </Pill>
          </>
        }
      />
    );
  };
}

export function quit(fresh: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.quit);
    const c = sideCard(g);
    const away = { opacity: t([[180, 1], [420, 0]]), transform: [{ scale: t([[180, 1], [420, 0.97]]) }] };
    const back = { opacity: t([[760, 0], [1080, 1]]), transform: [{ scale: t([[760, 0.97], [1080, 1]]) }] };
    const both = { opacity: t([[180, 1], [420, 0], [760, 0], [1080, 1]]), transform: [{ scale: t([[180, 1], [420, 0.97], [760, 0.97], [1080, 1]]) }] };
    const quiet = { ...opts };
    return (
      <>
        <Backdrop g={g} look={look} />
        <Animated.View style={[fill, fresh ? away : both]}>
          <Std g={g} look={look} opts={quiet} n={5} sel={0} />
        </Animated.View>
        {fresh ? (
          <Animated.View style={[fill, back]}>
            <Chrome g={g} look={look} opts={quiet} />
            <TabRow g={g} look={look} t={BLANK} y={rowY(0, listTop(opts))} selected />
            <NewTabButton g={g} look={look} y={rowY(1, listTop(opts))} />
            <Card g={g} look={look} rect={c}>
              <NewTabPage g={g} look={look} width={c.w} />
            </Card>
          </Animated.View>
        ) : null}
        <KeyPress g={g} look={look} t={t} label="⌘Q" />
      </>
    );
  };
}

export function windows(shared: boolean): Scene {
  return ({ g, look, p }) => {
    const t = tracker(p, sceneMs.windows);
    const w = (g.W - 50) / 2;
    const h = g.H - 56;
    const a: Rect = { x: 18, y: 26, w, h };
    const b: Rect = { x: 32 + w, y: 30, w, h };
    const list = [tab(0), tab(1), tab(2), tab(3)];
    const other = shared ? list : [tab(4), tab(5), tab(6)];
    const cursorFrom = { x: a.x + w * 0.62, y: a.y + h * 0.78 };
    const cursorTo = { x: a.x + 70, y: a.y + rowY(2) + 14 };
    const dimB = (i: number) => {
      if (!shared) return null;
      if (i === 0) return { opacity: t([[560, 0.4], [820, 1]]) };
      if (i === 2) return { opacity: t([[560, 1], [820, 0.4]]) };
      return null;
    };
    return (
      <>
        <Desktop g={g} look={look} />
        <MiniArdia
          g={g}
          look={look}
          rect={a}
          tabs={list}
          dim={(i) => (shared && i === 1 ? { opacity: 0.4 } : null)}
          extra={<Highlight g={g} look={look} y={rowY(0)} w={MINI_SIDE - 12} style={{ transform: [{ translateY: t([[520, 0], [820, 2 * ROW.pitch * g.s]]) }] }} />}
          cardContent={
            <>
              <Animated.View style={[fill, { opacity: t.out(560, 200) }]}>
                <Page g={g} look={look} top={TOOLBAR_H} />
              </Animated.View>
              <Animated.View style={[fill, { opacity: t.in(600, 260) }]}>
                <Page g={g} look={look} a={TRIP} top={TOOLBAR_H} />
              </Animated.View>
            </>
          }
        />
        <MiniArdia g={g} look={look} rect={b} tabs={other} sel={shared ? 1 : 0} dim={dimB} />
        <Cursor
          g={g}
          style={{
            opacity: t([[100, 0], [260, 1], [1150, 1], [1380, 0]]),
            transform: [
              { translateX: t([[100, cursorFrom.x * g.s], [460, cursorTo.x * g.s]]) },
              { translateY: t([[100, cursorFrom.y * g.s], [460, cursorTo.y * g.s]]) },
              { scale: t([[480, 1], [520, 0.85], [640, 1]], linear) },
            ],
          }}
        />
      </>
    );
  };
}
