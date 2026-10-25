import { Surface } from "@ardia/shell";
import type { ReactNode } from "react";
import { Animated, View } from "react-native";
import { hex } from "../../../lib/theme";
import type { PreviewId } from "./ids";
import {
  at,
  atRect,
  Backdrop,
  Card,
  CHIP,
  Crumb,
  Cursor,
  FIELD,
  fill,
  Glyph,
  hairline,
  Highlight,
  InputRow,
  Keycap,
  Label,
  Lights,
  LIGHTS_Y,
  linear,
  lookFor,
  NavIcons,
  NEW_TAB,
  NewTabButton,
  NewTabPage,
  NOTES,
  Page,
  Panel,
  Pill,
  ROW,
  rowY,
  Rows,
  SIDEBAR_ICONS,
  SidebarField,
  sideCard,
  STRIP_H,
  SuggestionRow,
  tab,
  TabRow,
  Toolbar,
  TOOLBAR_H,
  TOOLBAR_ICONS,
  CRUMB_X,
  topCard,
  tracker,
  TRIP,
  type Article,
  type Geo,
  type Look,
  type Rect,
  type Suggestion,
  type Tab,
  type Tracker,
} from "./kit";

export type SceneOpts = { addressInSidebar: boolean; systemDark: boolean; accent: string };
export type SceneProps = { g: Geo; look: Look; p: Animated.Value; opts: SceneOpts };
type Scene = (props: SceneProps) => ReactNode;

const BLANK: Tab = { title: "New Tab", host: "", color: "#A1A1A6", icon: "globe" };
const listTop = (opts: SceneOpts) => (opts.addressInSidebar ? ROW.topWithField : ROW.top);

function Chrome({ g, look, opts, sel = 0 }: { g: Geo; look: Look; opts: SceneOpts; sel?: number }) {
  return (
    <>
      <Backdrop g={g} look={look} />
      <Lights g={g} y={opts.addressInSidebar ? LIGHTS_Y.field : LIGHTS_Y.toolbar} />
      {opts.addressInSidebar ? (
        <>
          <NavIcons g={g} color={look.t.icon} xs={SIDEBAR_ICONS} y={LIGHTS_Y.field} names={["sidebar.left", "chevron.left", "chevron.right"]} />
          <SidebarField g={g} look={look} t={tab(sel)} />
        </>
      ) : null}
    </>
  );
}

function Std({ g, look, opts, n = 4, sel = 0, rows, page, card, a = NOTES, site }: { g: Geo; look: Look; opts: SceneOpts; n?: number; sel?: number; rows?: ReactNode; page?: ReactNode; card?: ReactNode; a?: Article; site?: boolean }) {
  const c = sideCard(g);
  const field = opts.addressInSidebar;
  return (
    <>
      <Chrome g={g} look={look} opts={opts} sel={sel} />
      {rows ?? <Rows g={g} look={look} n={n} sel={sel} top={listTop(opts)} />}
      <Card g={g} look={look} rect={c}>
        {field ? null : <Toolbar g={g} look={look} w={c.w} t={tab(sel)} site={site} />}
        {page ?? <Page g={g} look={look} a={a} top={field ? 0 : TOOLBAR_H} />}
        {card}
      </Card>
    </>
  );
}

function KeyPress({ g, look, t, label, ms = 0 }: { g: Geo; look: Look; t: Tracker; label: string; ms?: number }) {
  return (
    <Keycap
      g={g}
      look={look}
      x={g.W - 22}
      y={g.H - 50}
      label={label}
      style={{ opacity: t.in(ms, 160), transform: [{ scale: t([[ms, 0.82], [ms + 260, 1]]) }] }}
    />
  );
}

const CURRENT: Suggestion[] = [
  { fav: tab(0), title: "A slow morning on the coast trail", detail: "fieldnotes.blog" },
  { fav: tab(2), title: "Weekend in Lisbon", hint: "Switch to Tab" },
  { icon: "magnifyingglass", title: "coast trail walks" },
];

const FRESH: Suggestion[] = [
  { fav: tab(1), title: "Inbox", hint: "Switch to Tab" },
  { fav: tab(3), title: "Q4 roadmap", detail: "docs.new" },
  { icon: "clock", title: "coast trail walks" },
];

function SuggestionList({ g, look, t, rows, ms }: { g: Geo; look: Look; t: Tracker; rows: Suggestion[]; ms: number }) {
  return (
    <View style={{ paddingHorizontal: 9 * g.s, paddingTop: 4 * g.s }}>
      {rows.map((s, i) => (
        <SuggestionRow key={i} g={g} look={look} s={s} selected={i === 0} style={{ opacity: t.in(ms + i * 50, 200), transform: [{ translateY: t([[ms + i * 50, -3 * g.s], [ms + i * 50 + 220, 0]]) }] }} />
      ))}
    </View>
  );
}

function SelectedUrl({ g, look }: { g: Geo; look: Look }) {
  return (
    <View style={{ backgroundColor: look.t.selection, borderRadius: 2 * g.s, paddingHorizontal: 1 * g.s }}>
      <Label g={g} size={14} color={look.t.textPrimary}>
        fieldnotes.blog/coast-trail
      </Label>
    </View>
  );
}

function Divider({ g, look }: { g: Geo; look: Look }) {
  return <View style={{ height: hairline, marginHorizontal: 14 * g.s, backgroundColor: look.t.divider }} />;
}

const PANEL_H = 52 + 3 * 35 + 14;

function centredFrame(g: Geo): Rect {
  const c = sideCard(g);
  const content = c.w < 708 ? (c.w <= 636 ? c.w - 20 : 616) : 652;
  const w = Math.min(content, c.w - 28, 560);
  return { x: c.x + (c.w - w) / 2, y: c.y + Math.max(12, Math.round(c.h * 0.22)), w, h: PANEL_H };
}

function grow(t: Tracker, g: Geo, from: Rect, to: Rect, ms: number, dur = 260) {
  const sx = from.w / to.w;
  const sy = from.h / to.h;
  return {
    opacity: t([[ms, 0.4], [ms + 90, 1]]),
    transform: [
      { translateX: t([[ms, (from.x - to.x - (to.w * (1 - sx)) / 2) * g.s], [ms + dur, 0]]) },
      { translateY: t([[ms, (from.y - to.y - (to.h * (1 - sy)) / 2) * g.s], [ms + dur, 0]]) },
      { scaleX: t([[ms, sx], [ms + dur, 1]]) },
      { scaleY: t([[ms, sy], [ms + dur, 1]]) },
    ],
  };
}

const drop = (t: Tracker, g: Geo, ms: number) => ({ opacity: t.in(ms, 200), transform: [{ translateY: t([[ms, -10 * g.s], [ms + 300, 0]]) }, { scale: t([[ms, 0.97], [ms + 300, 1]]) }] });

function SwapCrumb({ g, look, t, a, b, ms, x, y }: { g: Geo; look: Look; t: Tracker; a: Tab; b: Tab; ms: number; x: number; y: number }) {
  return (
    <>
      <Crumb g={g} look={look} t={a} style={[at(g, x, y, 420, 18), { opacity: t.out(ms, 180) }]} />
      <Crumb g={g} look={look} t={b} style={[at(g, x, y, 420, 18), { opacity: t.in(ms + 60, 220) }]} />
    </>
  );
}

const TabsSidebar: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, 1200);
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

const TabsTop: Scene = ({ g, look, p }) => {
  const t = tracker(p, 1200);
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

function addressMove(toSidebar: boolean): Scene {
  return ({ g, look, p }) => {
    const t = tracker(p, 1100);
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

const CmdlField: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, 1200);
  const c = sideCard(g);
  if (opts.addressInSidebar) {
    const to: Rect = { x: FIELD.x, y: FIELD.y, w: FIELD.w + 137, h: 40 + 3 * 35 + 14 };
    return (
      <>
        <Std g={g} look={look} opts={opts} />
        <Panel g={g} look={look} rect={to} radius={12} style={grow(t, g, FIELD, to, 240)}>
          <InputRow g={g} look={look} height={40}>
            <SelectedUrl g={g} look={look} />
          </InputRow>
          <Divider g={g} look={look} />
          <SuggestionList g={g} look={look} t={t} rows={CURRENT} ms={400} />
        </Panel>
        <KeyPress g={g} look={look} t={t} label="⌘L" />
      </>
    );
  }
  const from: Rect = { x: c.x + CRUMB_X - 8, y: c.y + 6, w: 300, h: 30 };
  const to: Rect = { x: c.x + CRUMB_X - 40, y: c.y + 0.5, w: Math.min(480, c.w - CRUMB_X + 28), h: PANEL_H };
  return (
    <>
      <Std g={g} look={look} opts={opts} />
      <Panel g={g} look={look} rect={to} style={grow(t, g, from, to, 240)}>
        <InputRow g={g} look={look}>
          <SelectedUrl g={g} look={look} />
        </InputRow>
        <Divider g={g} look={look} />
        <SuggestionList g={g} look={look} t={t} rows={CURRENT} ms={400} />
      </Panel>
      <KeyPress g={g} look={look} t={t} label="⌘L" />
    </>
  );
};

const CmdlCentred: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, 1200);
  return (
    <>
      <Std g={g} look={look} opts={opts} />
      <Panel g={g} look={look} rect={centredFrame(g)} style={drop(t, g, 240)}>
        <InputRow g={g} look={look}>
          <SelectedUrl g={g} look={look} />
        </InputRow>
        <Divider g={g} look={look} />
        <SuggestionList g={g} look={look} t={t} rows={CURRENT} ms={400} />
      </Panel>
      <KeyPress g={g} look={look} t={t} label="⌘L" />
    </>
  );
};

const NewTabOpensPage: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, 1300);
  const c = sideCard(g);
  const top = listTop(opts);
  const field = opts.addressInSidebar;
  return (
    <Std
      g={g}
      look={look}
      opts={opts}
      rows={
        <>
          <Highlight g={g} look={look} y={rowY(0, top)} style={{ opacity: t.out(360, 200) }} />
          <Rows g={g} look={look} n={4} top={top} newTab={false} />
          <TabRow g={g} look={look} t={BLANK} y={rowY(4, top)} selected style={{ opacity: t.in(300, 240), transform: [{ translateX: t([[300, -12 * g.s], [600, 0]]) }] }} />
          <NewTabButton g={g} look={look} y={rowY(4, top)} style={{ transform: [{ translateY: t([[300, 0], [600, ROW.pitch * g.s]]) }] }} />
          <KeyPress g={g} look={look} t={t} label="⌘T" />
        </>
      }
      card={
        <Animated.View style={[fill, { opacity: t.in(420, 300) }]}>
          <NewTabPage g={g} look={look} width={c.w} top={field ? 0 : 0} />
        </Animated.View>
      }
    />
  );
};

function Typed({ g, look, t, text, at: ms, step, caretUntil }: { g: Geo; look: Look; t: Tracker; text: string; at: number; step: number; caretUntil: number }) {
  const caret = (from: number, to: number) => t([[from, 0], [from + 1, 1], [to, 1], [to + 1, 0]], linear);
  const bar = { position: "absolute" as const, width: 1.2 * g.s, height: 17 * g.s, borderRadius: 0.6 * g.s, backgroundColor: look.t.accent };
  return (
    <>
      <Animated.View style={[bar, { left: 0, opacity: caret(-1, ms) }]} />
      {text.split("").map((ch, i) => (
        <Animated.View key={i} style={{ opacity: t.step(ms + i * step) }}>
          <Label g={g} size={15} color={look.t.textPrimary}>
            {ch}
          </Label>
          <Animated.View style={[bar, { right: -1.4 * g.s, top: 1 * g.s, opacity: caret(ms + i * step, i === text.length - 1 ? caretUntil : ms + (i + 1) * step) }]} />
        </Animated.View>
      ))}
    </>
  );
}

const NewTabOpensBar: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, 1300);
  return (
    <>
      <Std g={g} look={look} opts={opts} />
      <Panel g={g} look={look} rect={centredFrame(g)} style={drop(t, g, 240)}>
        <InputRow g={g} look={look}>
          <View style={{ width: 1.2 * g.s, height: 17 * g.s, borderRadius: 0.6 * g.s, backgroundColor: look.t.accent, marginRight: 2 * g.s }} />
          <Label g={g} size={15} color={look.t.placeholder}>
            Search or enter address
          </Label>
        </InputRow>
        <Divider g={g} look={look} />
        <SuggestionList g={g} look={look} t={t} rows={FRESH} ms={400} />
      </Panel>
      <KeyPress g={g} look={look} t={t} label="⌘T" />
    </>
  );
};

function newTabAt(top: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, 1100);
    const list = listTop(opts);
    const shift = { transform: [{ translateY: t([[200, 0], [520, ROW.pitch * g.s]]) }] };
    return (
      <Std
        g={g}
        look={look}
        opts={opts}
        rows={
          <>
            <Animated.View style={[fill, top ? shift : null]}>
              <Highlight g={g} look={look} y={rowY(0, list)} style={{ opacity: t.out(280, 220) }} />
              <Rows g={g} look={look} n={4} top={list} newTab={false} />
            </Animated.View>
            <TabRow
              g={g}
              look={look}
              t={BLANK}
              y={rowY(top ? 0 : 4, list)}
              selected
              style={{
                opacity: t.in(top ? 320 : 220, 240),
                transform: top ? [{ translateX: t([[320, -12 * g.s], [620, 0]]) }] : [{ translateY: t([[220, -8 * g.s], [520, 0]]) }, { scale: t([[220, 0.96], [520, 1]]) }],
              }}
            />
            <NewTabButton g={g} look={look} y={rowY(4, list)} style={shift} />
          </>
        }
      />
    );
  };
}

function tidy(auto: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, 1500);
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

function quit(fresh: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, 1500);
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

const DESKTOP = { light: ["#D9DCE4", "#C4C9D6"], dark: ["#1C1D22", "#2B2D35"] } as const;

function Desktop({ g, look }: { g: Geo; look: Look }) {
  const [a, b] = look.dark ? DESKTOP.dark : DESKTOP.light;
  return <Backdrop g={g} look={{ ...look, tint: [a, b] }} />;
}

function Window({ g, look, rect, children }: { g: Geo; look: Look; rect: Rect; children: ReactNode }) {
  return (
    <View style={atRect(g, rect)}>
      <Surface fill={hex(look.tint[1])} cornerRadius={11 * g.s} borderColor={look.dark ? "#FFFFFF26" : "#0000001F"} borderWidth={0.5} shadowColor="#000000" shadowOpacity={look.dark ? 0.55 : 0.22} shadowRadius={22 * g.s} shadowOffset={[0, 10 * g.s]} style={fill} />
      <View style={[fill, { borderRadius: 11 * g.s, overflow: "hidden" }]}>{children}</View>
    </View>
  );
}

const MINI_SIDE = 150;

function MiniArdia({ g, look, rect, tabs, sel, dim, rowStyle, extra, cardContent }: { g: Geo; look: Look; rect: Rect; tabs: Tab[]; sel?: number; dim?: (i: number) => object | null; rowStyle?: (i: number) => object | null; extra?: ReactNode; cardContent?: ReactNode }) {
  const card: Rect = { x: MINI_SIDE + 7, y: 6, w: rect.w - MINI_SIDE - 14, h: rect.h - 13 };
  return (
    <Window g={g} look={look} rect={rect}>
      <Backdrop g={g} look={look} />
      <Lights g={g} />
      {extra}
      {tabs.map((tb, i) => (
        <TabRow key={i} g={g} look={look} t={tb} y={rowY(i)} w={MINI_SIDE - 12} selected={i === sel} style={[dim?.(i), rowStyle?.(i)]} />
      ))}
      <Card g={g} look={look} rect={card}>
        <Toolbar g={g} look={look} w={card.w} t={tabs[sel ?? 0] ?? tab(0)} icons={[21, 56]} crumbX={84} />
        {cardContent ?? <Page g={g} look={look} top={TOOLBAR_H} />}
      </Card>
    </Window>
  );
}

function windows(shared: boolean): Scene {
  return ({ g, look, p }) => {
    const t = tracker(p, 1400);
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

function appearance(mode: "light" | "dark" | "auto"): Scene {
  return ({ g, p, opts }) => {
    const t = tracker(p, 1200);
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
            <Glyph g={g} name={icon} size={14} color={toDark ? "#C7CCE6" : "#E3A21A"} weight="medium" box={18} />
          </Animated.View>
          <Label g={g} size={13} color={to.t.textPrimary} weight="500">
            {label}
          </Label>
        </Pill>
      </>
    );
  };
}

function siteColor(on: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, 1300);
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

const TYPE_AT = 180;
const TYPE_STEP = 75;
const TYPED = "github";
const TYPED_DONE = TYPE_AT + TYPED.length * TYPE_STEP;
const GITHUB = tab(6);

function typed(search: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, 1300);
    const site: Suggestion = { fav: GITHUB, title: "github.com", detail: "GitHub", hint: "Visit" };
    const query: Suggestion = { icon: "magnifyingglass", title: "github", detail: "Search Google", hint: "Search" };
    const rows = search ? [query, site] : [site, query];
    return (
      <>
        <Std g={g} look={look} opts={opts} />
        <Panel g={g} look={look} rect={{ ...centredFrame(g), h: 52 + 2 * 35 + 14 }} style={drop(t, g, 0)}>
          <InputRow g={g} look={look}>
            <Typed g={g} look={look} t={t} text={TYPED} at={TYPE_AT} step={TYPE_STEP} caretUntil={search ? 1300 : TYPED_DONE + 100} />
            {search ? null : (
              <Animated.View style={{ opacity: t.step(TYPED_DONE + 100), backgroundColor: look.t.selection, borderRadius: 2 * g.s }}>
                <Label g={g} size={15} color={look.t.textPrimary}>
                  .com
                </Label>
              </Animated.View>
            )}
          </InputRow>
          <Divider g={g} look={look} />
          <View style={{ paddingHorizontal: 9 * g.s, paddingTop: 4 * g.s }}>
            {rows.map((s, i) => (
              <Animated.View key={i} style={{ opacity: t.in(TYPED_DONE + 140 + i * 60, 200) }}>
                <SuggestionRow g={g} look={look} s={s} selected={i === 0} />
              </Animated.View>
            ))}
          </View>
        </Panel>
      </>
    );
  };
}

const AD_FILL = { light: "#F6F1DE", dark: "#2A2719" } as const;

function AdBox({ g, look, style, h, children }: { g: Geo; look: Look; style?: object; h: number; children?: ReactNode }) {
  return (
    <Animated.View style={[{ height: h * g.s, borderRadius: 8 * g.s, backgroundColor: look.dark ? AD_FILL.dark : AD_FILL.light, borderWidth: hairline, borderColor: look.dark ? "#5A5130" : "#E2D6A8", alignItems: "center", justifyContent: "center" }, style]}>
      <Label g={g} size={10} color={look.dark ? "#B9A867" : "#9C8A45"} weight="600">
        AD
      </Label>
      {children}
    </Animated.View>
  );
}

function block(on: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, 1300);
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
              <Surface fill={hex(look.t.panel)} cornerRadius={12 * g.s} borderColor={hex(look.t.panelBorder)} borderWidth={0.5} shadowColor="#000000" shadowOpacity={look.dark ? 0.5 : 0.14} shadowRadius={16 * g.s} shadowOffset={[0, 4 * g.s]} style={{ height: 52 * g.s, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 * g.s, gap: 12 * g.s }}>
                <View style={{ flex: 1 }}>
                  <Label g={g} size={12.5} color={look.t.textPrimary}>
                    We use cookies to personalise ads and measure traffic.
                  </Label>
                </View>
                <View style={{ height: 28 * g.s, paddingHorizontal: 12 * g.s, borderRadius: 8 * g.s, backgroundColor: look.t.goButton, justifyContent: "center" }}>
                  <Label g={g} size={12} color={look.t.goButtonText} weight="600">
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

function Bubble({ g, look, mine, children, style }: { g: Geo; look: Look; mine?: boolean; children: ReactNode; style?: object }) {
  return (
    <Animated.View style={[{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", borderRadius: 16 * g.s, paddingHorizontal: 12 * g.s, paddingVertical: 7 * g.s, backgroundColor: mine ? "#2F7BF6" : look.dark ? "#3A3A3C" : "#E9E9EB" }, style]}>
      {typeof children === "string" ? (
        <Label g={g} size={12.5} color={mine ? "#FFFFFF" : look.t.textPrimary} lines={3}>
          {children}
        </Label>
      ) : (
        children
      )}
    </Animated.View>
  );
}

function links(little: boolean): Scene {
  return ({ g, look, p }) => {
    const t = tracker(p, 1500);
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
          <View style={[fill, { backgroundColor: look.dark ? "#1E1E1E" : "#FFFFFF" }]} />
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
              <Animated.View style={[fill, { backgroundColor: "rgba(0,0,0,0.12)", opacity: t([[470, 0], [510, 1], [700, 0]], linear) }]} />
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

export const DEMOS: Record<PreviewId, { duration: number; Scene: Scene }> = {
  "tabs-sidebar": { duration: 1200, Scene: TabsSidebar },
  "tabs-top": { duration: 1200, Scene: TabsTop },
  "address-toolbar": { duration: 1100, Scene: addressMove(false) },
  "address-sidebar": { duration: 1100, Scene: addressMove(true) },
  "cmdl-field": { duration: 1200, Scene: CmdlField },
  "cmdl-centred": { duration: 1200, Scene: CmdlCentred },
  "newtab-page": { duration: 1300, Scene: NewTabOpensPage },
  "newtab-commandbar": { duration: 1300, Scene: NewTabOpensBar },
  "newtabpos-bottom": { duration: 1100, Scene: newTabAt(false) },
  "newtabpos-top": { duration: 1100, Scene: newTabAt(true) },
  "tidy-keep": { duration: 1500, Scene: tidy(false) },
  "tidy-auto": { duration: 1500, Scene: tidy(true) },
  "quit-restore": { duration: 1500, Scene: quit(false) },
  "quit-fresh": { duration: 1500, Scene: quit(true) },
  "windows-separate": { duration: 1400, Scene: windows(false) },
  "windows-shared": { duration: 1400, Scene: windows(true) },
  "appearance-auto": { duration: 1200, Scene: appearance("auto") },
  "appearance-light": { duration: 1200, Scene: appearance("light") },
  "appearance-dark": { duration: 1200, Scene: appearance("dark") },
  "sitecolor-on": { duration: 1300, Scene: siteColor(true) },
  "sitecolor-off": { duration: 1300, Scene: siteColor(false) },
  "typed-website": { duration: 1300, Scene: typed(false) },
  "typed-search": { duration: 1300, Scene: typed(true) },
  "block-on": { duration: 1300, Scene: block(true) },
  "block-off": { duration: 1300, Scene: block(false) },
  "links-little": { duration: 1500, Scene: links(true) },
  "links-tab": { duration: 1500, Scene: links(false) },
};
