import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";
import { CODE, FILE_NAME, tokenize, type CodeLine, type Group } from "./code";
import footage from "./footage.json";

loadFonts();

export const FPS = 30;
const TITLE = 3.0;
const SECTION = 11.5;
const END = 4.0;
const BEFORE_AT = TITLE;
const AFTER_AT = TITLE + SECTION;
const END_AT = TITLE + SECTION * 2;
export const TOTAL_FRAMES = Math.round((END_AT + END) * FPS);

const TYPE_1: [number, number] = [0.6, 2.8];
const SAVE_1 = 3.2;
const TYPE_2: [number, number] = [4.4, 7.4];
const SAVE_2 = 7.9;
const PRE_SAVE = 0.9;

const WINDOW_SIZE: [number, number] = [1360, 860];
const WIN = { left: 60, top: 190, width: 1250 };
const K = WIN.width / WINDOW_SIZE[0];
const WIN_H = Math.round(WINDOW_SIZE[1] * K);
const PANEL = { left: 1150, top: 222, width: 710, height: 686 };
const GUTTER = 62;
const CODE_SIZE = 16;
const LINE_H = 22;
const TOAST_BOX = { x: 560, y: 745, w: 420, h: 86 };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.out(Easing.cubic);

const editor = {
  bg: "#17140F",
  bar: "#211D18",
  gutter: "#5E574D",
  punct: "#9C9385",
  key: "#F2B880",
  string: "#A9D18E",
  number: "#8DB8F2",
  text: "#EFE8DC",
  added: "rgba(242, 184, 128, 0.08)",
};

const label: CSSProperties = {
  fontFamily: font.mono,
  fontWeight: 460,
  fontStretch: "87.5%",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontSize: 20,
  color: color.ink2,
};

type Side = "before" | "after";
type Phase = "default" | "colours" | "look";
type FootageSide = { size: number[]; phases: Record<string, [number, string][]>; toast: number[] | null } | null;

const sides = footage as unknown as Record<Side, FootageSide>;

const seconds = (frame: number) => frame / FPS;

function rise(t: number, at: number, distance = 24): CSSProperties {
  return {
    opacity: interpolate(t, [at, at + 0.5], [0, 1], clamp),
    transform: `translateY(${interpolate(t, [at, at + 0.7], [distance, 0], { ...clamp, easing: ease })}px)`,
  };
}

function frameAt(side: FootageSide, t: number): string | null {
  if (!side) return null;
  const pick = (phase: Phase, since: number) => {
    const list = side.phases[phase] ?? [];
    if (!list.length) return null;
    let best = list[0]!;
    for (const entry of list) if (Math.abs(entry[0] - since) < Math.abs(best[0] - since)) best = entry;
    return best[1];
  };
  if (t < SAVE_1 - PRE_SAVE) {
    const list = side.phases.default ?? [];
    return list.length ? list[Math.min(list.length - 1, Math.floor((t / (SAVE_1 - PRE_SAVE)) * list.length))]![1] : null;
  }
  if (t < SAVE_2 - PRE_SAVE) return pick("colours", t - SAVE_1);
  return pick("look", t - SAVE_2);
}

function typedChars(group: Group, t: number) {
  const lines = CODE.filter((l) => l.group === group);
  const total = lines.reduce((n, l) => n + l.text.length, 0);
  const span = group === 1 ? TYPE_1 : group === 2 ? TYPE_2 : null;
  if (!span) return Infinity;
  return Math.floor(interpolate(t, span, [0, total], clamp));
}

function visibleLines(t: number) {
  const budget: Record<Group, number> = { 0: Infinity, 1: typedChars(1, t), 2: typedChars(2, t) };
  const shown: { line: CodeLine; text: string; typing: boolean; index: number }[] = [];
  let cursorLine = 1;
  CODE.forEach((line, index) => {
    const left = budget[line.group];
    if (left <= 0) return;
    const text = line.text.slice(0, Math.min(line.text.length, left));
    budget[line.group] = left - line.text.length;
    const typing = text.length < line.text.length;
    const comma = line.commaFrom !== undefined && typedChars(line.commaFrom, t) > 0 ? "," : "";
    shown.push({ line, text: typing ? text : text + comma, typing, index });
    if (line.group !== 0) cursorLine = shown.length - 1;
  });
  return { shown, cursorLine };
}

function CodeText({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((tok, i) => (
        <span key={i} style={{ color: tok.kind === "space" ? undefined : editor[tok.kind === "punct" ? "punct" : tok.kind] }}>
          {tok.text}
        </span>
      ))}
    </>
  );
}

function CodePanel({ t, side }: { t: number; side: Side }) {
  const { shown, cursorLine } = visibleLines(t);
  const dirty = (t > TYPE_1[0] && t < SAVE_1) || (t > TYPE_2[0] && t < SAVE_2);
  const typing = (t >= TYPE_1[0] && t <= TYPE_1[1]) || (t >= TYPE_2[0] && t <= TYPE_2[1]);
  const blink = typing || Math.floor(t * 2) % 2 === 0;
  const marked = t > SAVE_2 + 0.25;
  const markIn = interpolate(t, [SAVE_2 + 0.25, SAVE_2 + 0.55], [0, 1], clamp);
  const added = (line: CodeLine) => (line.group === 1 && t > TYPE_1[0] && t < SAVE_1 + 0.6) || (line.group === 2 && t > TYPE_2[0] && t < SAVE_2 + 0.6);
  return (
    <div
      style={{
        position: "absolute",
        left: PANEL.left,
        top: PANEL.top,
        width: PANEL.width,
        height: PANEL.height,
        borderRadius: 16,
        background: editor.bg,
        boxShadow: "0 30px 70px rgba(22, 19, 15, 0.38), 0 0 0 1px rgba(22, 19, 15, 0.2)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 46, background: editor.bar, display: "flex", alignItems: "center", padding: "0 20px", gap: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["#5E574D", "#5E574D", "#5E574D"].map((c, i) => (
            <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
        <div style={{ fontFamily: font.mono, fontStretch: "87.5%", fontSize: 16, color: editor.text, marginLeft: 10 }}>{FILE_NAME}</div>
        <div style={{ width: 9, height: 9, borderRadius: 5, background: editor.key, opacity: dirty ? 1 : 0 }} />
      </div>
      <div style={{ padding: "22px 0 0 0", fontFamily: font.mono, fontStretch: "75%", fontSize: CODE_SIZE, lineHeight: `${LINE_H}px`, whiteSpace: "pre" }}>
        {shown.map(({ line, text, index }, i) => {
          const isLook = !!line.lookKey;
          return (
            <div key={index} style={{ display: "flex", position: "relative", background: added(line) ? editor.added : "transparent" }}>
              <div style={{ width: GUTTER, textAlign: "right", paddingRight: 18, color: editor.gutter, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ position: "relative", color: editor.text }}>
                <CodeText text={text} />
                {i === cursorLine && blink ? <span style={{ display: "inline-block", width: 2, height: 18, background: editor.text, verticalAlign: "-3px", marginLeft: 1 }} /> : null}
                {isLook && marked ? (
                  <div
                    style={{
                      position: "absolute",
                      left: "2ch",
                      width: `${(line.lookKey?.length ?? 0) + 2}ch`,
                      bottom: 1,
                      height: 3,
                      opacity: markIn,
                      background:
                        side === "before"
                          ? `repeating-linear-gradient(135deg, ${color.stamp} 0 3px, transparent 3px 6px)`
                          : "#6F9BF5",
                      borderRadius: 2,
                    }}
                  />
                ) : null}
              </div>
              {isLook && marked ? (
                <div
                  style={{
                    position: "absolute",
                    left: 10,
                    top: 6,
                    width: 11,
                    height: 11,
                    borderRadius: 6,
                    opacity: markIn,
                    background: side === "before" ? color.stamp : "#6F9BF5",
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Keycap({ t }: { t: number }) {
  const at = t >= SAVE_2 ? SAVE_2 : t >= SAVE_1 ? SAVE_1 : null;
  if (at === null || t > at + 0.9) return null;
  const k = t - at;
  return (
    <div
      style={{
        position: "absolute",
        left: PANEL.left + PANEL.width - 20,
        top: PANEL.top + 60,
        transform: `translate(-100%, ${interpolate(k, [0, 0.15], [8, 0], { ...clamp, easing: ease })}px)`,
        opacity: interpolate(k, [0, 0.08, 0.7, 0.9], [0, 1, 1, 0], clamp),
        padding: "8px 16px",
        borderRadius: 10,
        background: color.paper,
        color: color.ink,
        fontFamily: font.poster,
        fontWeight: 760,
        fontSize: 26,
        lineHeight: 1,
      }}
    >
      ⌘S
    </div>
  );
}

function WindowShot({ t, side }: { t: number; side: Side }) {
  const data = sides[side];
  const file = frameAt(data, t);
  const frameStyle: CSSProperties = {
    position: "absolute",
    left: WIN.left,
    top: WIN.top,
    width: WIN.width,
    height: WIN_H,
    borderRadius: Math.round(21 * K),
    overflow: "hidden",
    boxShadow: "0 30px 70px rgba(22, 19, 15, 0.3), 0 0 0 1px rgba(22, 19, 15, 0.12)",
  };
  const toast = data?.toast;
  const ringOn = side === "before" && toast ? interpolate(t - SAVE_2, [toast[0] + 0.2, toast[0] + 0.4, toast[1] - 0.1, toast[1] + 0.1], [0, 1, 1, 0], clamp) : 0;
  return (
    <>
      {file ? (
        <div style={frameStyle}>
          <Img src={staticFile(file)} style={{ width: WIN.width, height: WIN_H, display: "block" }} />
        </div>
      ) : (
        <div style={{ ...frameStyle, background: color.night2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
          <div style={{ ...label, color: color.nightInk, fontSize: 26 }}>After footage pending</div>
          <div style={{ ...label, color: color.nightInk2, fontSize: 16, textTransform: "none" }}>public/footage/theme-look-16x9/after</div>
        </div>
      )}
      {ringOn > 0 ? (
        <div
          style={{
            position: "absolute",
            left: WIN.left + (TOAST_BOX.x - 10) * K,
            top: WIN.top + (TOAST_BOX.y - 10) * K,
            width: (TOAST_BOX.w + 20) * K,
            height: (TOAST_BOX.h + 20) * K,
            borderRadius: 18,
            boxShadow: `0 0 0 4px ${color.stamp}`,
            opacity: ringOn,
          }}
        />
      ) : null}
    </>
  );
}

const COPY: Record<Side, { pill: string; version: string; headline: string; first: string; second: string }> = {
  before: {
    pill: "Before",
    version: "Ardia today",
    headline: "A theme stops at colour",
    first: "Saved: the colours change",
    second: "Saved: type, metrics, layout and icons aren't theme keys",
  },
  after: {
    pill: "After",
    version: "Ardia with theme looks",
    headline: "The same file sets the whole look",
    first: "Saved: the colours change",
    second: "Saved: new font, roomier rows, rounder tiles, back and forward hidden, address field and New Tab moved, icons swapped",
  },
};

function Caption({ t, side }: { t: number; side: Side }) {
  const copy = COPY[side];
  const second = t >= SAVE_2 + 0.3;
  const at = second ? SAVE_2 + 0.3 : SAVE_1 + 0.3;
  if (t < SAVE_1 + 0.3) return null;
  const tone = second ? (side === "before" ? color.stamp : color.blue) : color.ink;
  return (
    <div
      key={second ? "second" : "first"}
      style={{
        position: "absolute",
        left: WIN.left,
        top: WIN.top + WIN_H + 22,
        width: 1800,
        fontFamily: font.serif,
        fontSize: 30,
        lineHeight: 1.25,
        color: tone,
        ...rise(t, at, 12),
      }}
    >
      {second ? copy.second : copy.first}
    </div>
  );
}

function SectionShot({ side }: { side: Side }) {
  const t = seconds(useCurrentFrame());
  const copy = COPY[side];
  const fade = interpolate(t, [0, 0.3, SECTION - 0.35, SECTION], [0, 1, 1, 0], clamp);
  const after = side === "after";
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: 60, top: 46, display: "flex", alignItems: "center", gap: 16, ...rise(t, 0.05, 10) }}>
        <div
          style={{
            ...label,
            fontSize: 19,
            fontWeight: 620,
            color: after ? color.paper : color.ink,
            background: after ? color.blue : "transparent",
            boxShadow: after ? "none" : `inset 0 0 0 2px ${color.ink}`,
            padding: "6px 12px 5px",
            borderRadius: 8,
          }}
        >
          {copy.pill}
        </div>
        <div style={{ ...label, fontSize: 18 }}>{copy.version}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 92,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          fontSize: 72,
          lineHeight: 1,
          color: color.ink,
          ...rise(t, 0.12, 16),
        }}
      >
        {copy.headline}
      </div>
      <WindowShot t={t} side={side} />
      <CodePanel t={t} side={side} />
      <Keycap t={t} />
      <Caption t={t} side={side} />
    </AbsoluteFill>
  );
}

function TitleCard() {
  const t = seconds(useCurrentFrame());
  const out = interpolate(t, [TITLE - 0.35, TITLE], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(t, 0.1) }}>Ardia · theme files</div>
      <div
        style={{
          marginTop: 22,
          fontFamily: font.poster,
          fontWeight: 860,
          fontStretch: "75%",
          textTransform: "uppercase",
          fontSize: 150,
          lineHeight: 0.92,
          color: color.ink,
          ...rise(t, 0.3),
        }}
      >
        One file.
        <br />
        The whole look.
      </div>
      <div style={{ marginTop: 30, fontFamily: font.serif, fontSize: 38, color: color.ink2, ...rise(t, 0.6) }}>
        The same edit to <span style={{ fontFamily: font.mono, fontSize: 32, fontStretch: "87.5%" }}>{FILE_NAME}</span>, before and after.
      </div>
      <Img src={staticFile("brand/app-icon.png")} style={{ position: "absolute", right: 170, top: 300, width: 480, height: 480, ...rise(t, 0.4) }} />
    </AbsoluteFill>
  );
}

function EndCard() {
  const t = seconds(useCurrentFrame());
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: interpolate(t, [0, 0.6], [0, 1], clamp) }}>
      <Img src={staticFile("brand/app-icon.png")} style={{ width: 190, height: 190, ...rise(t, 0.1) }} />
      <div
        style={{
          marginTop: 34,
          maxWidth: 1500,
          textAlign: "center",
          fontFamily: font.poster,
          fontWeight: 820,
          fontStretch: "80%",
          fontSize: 76,
          lineHeight: 1.02,
          color: color.ink,
          ...rise(t, 0.25),
        }}
      >
        Fonts, sizes, layout and icons
        <br />
        from one theme file, live
      </div>
      <div style={{ ...label, marginTop: 30, fontSize: 24, color: color.blue, ...rise(t, 0.5) }}>ardia.dev</div>
    </AbsoluteFill>
  );
}

export function ThemeLookFilm() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={Math.round(TITLE * FPS)}>
        <TitleCard />
      </Sequence>
      <Sequence from={Math.round(BEFORE_AT * FPS)} durationInFrames={Math.round(SECTION * FPS)}>
        <SectionShot side="before" />
      </Sequence>
      <Sequence from={Math.round(AFTER_AT * FPS)} durationInFrames={Math.round(SECTION * FPS)}>
        <SectionShot side="after" />
      </Sequence>
      <Sequence from={Math.round(END_AT * FPS)} durationInFrames={Math.round(END * FPS)}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
}
