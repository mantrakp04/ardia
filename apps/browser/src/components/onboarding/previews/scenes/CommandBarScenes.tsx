import { Animated, View } from "react-native";
import { at, CRUMB_X, FIELD, fill, type Geo, type Rect, ROW, rowY, sideCard } from "../geometry";
import { BLANK, type Suggestion, tab } from "../content";
import type { Look } from "../look";
import { linear, tracker, type Tracker } from "../timeline";
import { Highlight, Label, NewTabButton, Rows, TabRow } from "../Kit";
import { NewTabPage } from "../MockPages";
import { InputRow, Panel, SuggestionRow } from "../Floating";
import { sceneMs } from "../tokens";
import type { Scene } from "../scene";
import { centredFrame, CURRENT, Divider, drop, FRESH, grow, KeyPress, listTop, PANEL_H, SelectedUrl, Std, SuggestionList } from "./SceneParts";

export const CmdlField: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, sceneMs.commandBar);
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

export const CmdlCentred: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, sceneMs.commandBar);
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

export const NewTabOpensPage: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, sceneMs.newTab);
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

export const NewTabOpensBar: Scene = ({ g, look, p, opts }) => {
  const t = tracker(p, sceneMs.newTab);
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

export function newTabAt(at: "top" | "bottom" | "next"): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.newTabPosition);
    const list = listTop(opts);
    const shift = { transform: [{ translateY: t([[200, 0], [520, ROW.pitch * g.s]]) }] };
    const slot = at === "top" ? 0 : at === "next" ? 1 : 4;
    const pushed = at === "next" ? 1 : 0;
    return (
      <Std
        g={g}
        look={look}
        opts={opts}
        rows={
          <>
            <Highlight g={g} look={look} y={rowY(0, list)} style={[at === "top" ? shift : null, { opacity: t.out(280, 220) }]} />
            {pushed ? <Rows g={g} look={look} n={1} top={list} newTab={false} /> : null}
            <Animated.View style={[fill, at === "bottom" ? null : shift]}>
              <Rows g={g} look={look} from={pushed} n={4 - pushed} top={rowY(pushed, list)} newTab={false} />
            </Animated.View>
            <TabRow
              g={g}
              look={look}
              t={BLANK}
              y={rowY(slot, list)}
              selected
              style={{
                opacity: t.in(at === "bottom" ? 220 : 320, 240),
                transform: at === "bottom" ? [{ translateY: t([[220, -8 * g.s], [520, 0]]) }, { scale: t([[220, 0.96], [520, 1]]) }] : [{ translateX: t([[320, -12 * g.s], [620, 0]]) }],
              }}
            />
            <NewTabButton g={g} look={look} y={rowY(4, list)} style={at === "bottom" ? null : shift} />
          </>
        }
      />
    );
  };
}

const TYPE_AT = 180;
const TYPE_STEP = 75;
const TYPED = "github";
const TYPED_DONE = TYPE_AT + TYPED.length * TYPE_STEP;
const GITHUB = tab(6);

export function typed(search: boolean): Scene {
  return ({ g, look, p, opts }) => {
    const t = tracker(p, sceneMs.typed);
    const site: Suggestion = { fav: GITHUB, title: "github.com", detail: "GitHub", hint: "Visit" };
    const query: Suggestion = { icon: "magnifyingglass", title: "github", detail: "Search Google", hint: "Search" };
    const rows = search ? [query, site] : [site, query];
    return (
      <>
        <Std g={g} look={look} opts={opts} />
        <Panel g={g} look={look} rect={{ ...centredFrame(g), h: 52 + 2 * 35 + 14 }} style={drop(t, g, 0)}>
          <InputRow g={g} look={look}>
            <Typed g={g} look={look} t={t} text={TYPED} at={TYPE_AT} step={TYPE_STEP} caretUntil={search ? sceneMs.typed : TYPED_DONE + 100} />
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
