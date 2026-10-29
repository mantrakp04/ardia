import type { ReactNode } from "react";
import { View } from "react-native";
import { Surface } from "../../../ui";
import { at, atRect, CARD, fill, type Geo, hairline, LIGHTS_Y, type Rect, ROW, rowY, SIDEBAR_ICONS, sideCard, TOOLBAR_H } from "../geometry";
import { type Article, NOTES, type Suggestion, tab, type Tab } from "../content";
import { type Look, pick } from "../look";
import type { Tracker } from "../timeline";
import { Backdrop, Card, Crumb, Label, Lights, NavIcons, Rows, SidebarField, TabRow, Toolbar } from "../Kit";
import { Page } from "../MockPages";
import { Keycap, SuggestionRow } from "../Floating";
import { mockInk } from "../tokens";
import { hex } from "../../../ui/theme";
import { ink } from "../../../ui/tokens";
import type { SceneOpts } from "../scene";

export const listTop = (opts: SceneOpts) => (opts.addressInSidebar ? ROW.topWithField : ROW.top);

export function Chrome({ g, look, opts, sel = 0 }: { g: Geo; look: Look; opts: SceneOpts; sel?: number }) {
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

export function Std({ g, look, opts, n = 4, sel = 0, rows, page, card, a = NOTES, site }: { g: Geo; look: Look; opts: SceneOpts; n?: number; sel?: number; rows?: ReactNode; page?: ReactNode; card?: ReactNode; a?: Article; site?: boolean }) {
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

export function KeyPress({ g, look, t, label, ms = 0 }: { g: Geo; look: Look; t: Tracker; label: string; ms?: number }) {
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

export const CURRENT: Suggestion[] = [
  { fav: tab(0), title: "A slow morning on the coast trail", detail: "fieldnotes.blog" },
  { fav: tab(2), title: "Weekend in Lisbon", hint: "Switch to Tab" },
  { icon: "magnifyingglass", title: "coast trail walks" },
];

export const FRESH: Suggestion[] = [
  { fav: tab(1), title: "Inbox", hint: "Switch to Tab" },
  { fav: tab(3), title: "Q4 roadmap", detail: "docs.new" },
  { icon: "clock", title: "coast trail walks" },
];

export function SuggestionList({ g, look, t, rows, ms }: { g: Geo; look: Look; t: Tracker; rows: Suggestion[]; ms: number }) {
  return (
    <View style={{ paddingHorizontal: 9 * g.s, paddingTop: 4 * g.s }}>
      {rows.map((s, i) => (
        <SuggestionRow key={i} g={g} look={look} s={s} selected={i === 0} style={{ opacity: t.in(ms + i * 50, 200), transform: [{ translateY: t([[ms + i * 50, -3 * g.s], [ms + i * 50 + 220, 0]]) }] }} />
      ))}
    </View>
  );
}

export function SelectedUrl({ g, look }: { g: Geo; look: Look }) {
  return (
    <View style={{ backgroundColor: look.t.selection, borderRadius: 2 * g.s, paddingHorizontal: 1 * g.s }}>
      <Label g={g} size={14} color={look.t.textPrimary}>
        fieldnotes.blog/coast-trail
      </Label>
    </View>
  );
}

export function Divider({ g, look }: { g: Geo; look: Look }) {
  return <View style={{ height: hairline, marginHorizontal: 14 * g.s, backgroundColor: look.t.divider }} />;
}

export const PANEL_H = 52 + 3 * 35 + 14;

export function centredFrame(g: Geo): Rect {
  const c = sideCard(g);
  const content = c.w < 708 ? (c.w <= 636 ? c.w - 20 : 616) : 652;
  const w = Math.min(content, c.w - 28, 560);
  return { x: c.x + (c.w - w) / 2, y: c.y + Math.max(12, Math.round(c.h * 0.22)), w, h: PANEL_H };
}

export function grow(t: Tracker, g: Geo, from: Rect, to: Rect, ms: number, dur = 260) {
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

export const drop = (t: Tracker, g: Geo, ms: number) => ({ opacity: t.in(ms, 200), transform: [{ translateY: t([[ms, -10 * g.s], [ms + 300, 0]]) }, { scale: t([[ms, 0.97], [ms + 300, 1]]) }] });

export function SwapCrumb({ g, look, t, a, b, ms, x, y }: { g: Geo; look: Look; t: Tracker; a: Tab; b: Tab; ms: number; x: number; y: number }) {
  return (
    <>
      <Crumb g={g} look={look} t={a} style={[at(g, x, y, 420, 18), { opacity: t.out(ms, 180) }]} />
      <Crumb g={g} look={look} t={b} style={[at(g, x, y, 420, 18), { opacity: t.in(ms + 60, 220) }]} />
    </>
  );
}

export function Desktop({ g, look }: { g: Geo; look: Look }) {
  const [a, b] = look.dark ? mockInk.desktop.dark : mockInk.desktop.light;
  return <Backdrop g={g} look={{ ...look, tint: [a, b] }} />;
}

export function Window({ g, look, rect, children }: { g: Geo; look: Look; rect: Rect; children: ReactNode }) {
  return (
    <View style={atRect(g, rect)}>
      <Surface fill={hex(look.tint[1])} cornerRadius={11 * g.s} borderColor={pick(look, [mockInk.appWindowEdge.light, mockInk.appWindowEdge.dark])} borderWidth={0.5} shadowColor={ink.black} shadowOpacity={look.dark ? 0.55 : 0.22} shadowRadius={22 * g.s} shadowOffset={[0, 10 * g.s]} style={fill} />
      <View style={[fill, { borderRadius: 11 * g.s, overflow: "hidden" }]}>{children}</View>
    </View>
  );
}

export const MINI_SIDE = 150;

export function MiniArdia({ g, look, rect, tabs, sel, dim, rowStyle, extra, cardContent }: { g: Geo; look: Look; rect: Rect; tabs: Tab[]; sel?: number; dim?: (i: number) => object | null; rowStyle?: (i: number) => object | null; extra?: ReactNode; cardContent?: ReactNode }) {
  const card: Rect = { x: MINI_SIDE + CARD - ROW.x, y: CARD, w: rect.w - MINI_SIDE - 2 * CARD + ROW.x, h: rect.h - 2 * CARD };
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
