import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Freeze, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";
import segments from "./segments.json";

loadFonts();

interface Event {
  t: number;
  x?: number;
  y?: number;
  down?: number;
  up?: number;
  hide?: number;
  mark?: string;
}

interface Note {
  t: number;
  until?: number;
  x: number;
  y: number;
  text: string;
}

interface Banner {
  t: number;
  title: string;
  body: string;
  subtitle: string;
  silent: boolean;
}

interface MenuItem {
  title?: string;
  symbol?: string;
  checked?: boolean;
  separator?: boolean;
  disabled?: boolean;
  open?: boolean;
  children?: MenuItem[];
}

interface MenuGeometry {
  x: number;
  y: number;
  subX: number;
  subY: number;
  width: number;
  subWidth: number;
  row: number;
  separator: number;
  pad: number;
}

interface Menu {
  t: number;
  until: number;
  sub: number | null;
  geometry: MenuGeometry;
  items: MenuItem[];
  light?: boolean;
  caption?: string;
}

interface PaneLine {
  t: number;
  text: string;
  dim?: boolean;
}

interface Pane {
  t: number;
  until?: number;
  x: number;
  y: number;
  w: number;
  title: string;
  style: "editor" | "terminal";
  lines: PaneLine[];
  saved?: number;
}

interface Clip {
  file?: string;
  still?: string;
  notes?: Note[];
  banners?: Banner[];
  menus?: Menu[];
  panes?: Pane[];
  w: number;
  h: number;
  scale: number;
  inS: number;
  outS: number;
  events: Event[];
}

type Section = "New" | "Fixed" | "Smaller";

interface Segment {
  scene: string;
  title: string;
  body: string;
  section: Section;
  kind?: "pair" | "text";
  card?: boolean;
  layout?: "side" | "stack" | "solo";
  cam: number[];
  zoom?: { cam: number[]; from: number; to: number };
  length: number;
  rate?: number;
  note?: string;
  beforeVersion?: string;
  afterVersion?: string;
  cursor?: boolean;
  afterOnly?: string;
  reason?: string;
  before?: Clip;
  after?: Clip;
}

const FPS = 60;
const INTRO = Math.round(2.8 * FPS);
const SECTION = Math.round(1.3 * FPS);
const CARD = Math.round(1.4 * FPS);
const BRISK_CARD = Math.round(0.9 * FPS);
const HOLD_IN = Math.round(0.5 * FPS);
const HOLD_OUT = Math.round(0.9 * FPS);
const BRISK_HOLD_OUT = Math.round(0.5 * FPS);
const OUTRO = Math.round(2.4 * FPS);
const AREA = { top: 250, bottom: 1040 };
const SIDE_BOX = { w: 880, h: AREA.bottom - AREA.top };
const STACK_BOX = { w: 1800, h: 330 };
const SOLO_BOX = { w: 1800, h: AREA.bottom - AREA.top };
const LEFT = 60;
const RIGHT = 980;
const CURSOR_PX_PER_PT = 2.72;
const CURSOR_TIP = { x: 18, y: 16 };
const RELEASE = "0.2.44";
const BEFORE_VERSION = "0.2.43";
const SYMBOLS = "footage/release-0244/symbols";
const SPEED_NAMES: Record<number, string> = { 2: "Double speed", 0.5: "Half speed", 0.25: "Quarter speed", 0.125: "Eighth speed" };
const SECTION_LINES: Record<Section, string> = {
  New: "What 0.2.44 can do that 0.2.43 couldn't.",
  Fixed: "The same clicks on both releases.",
  Smaller: "The small stuff, quickly.",
};

const all = segments as Segment[];
const rateOf = (s: Segment) => s.rate ?? 1;
const brisk = (s: Segment) => s.section === "Smaller";
const hasCard = (s: Segment) => s.card !== false;
const opensSection = all.map((s, i) => i === 0 || all[i - 1]!.section !== s.section);
const cardOf = (s: Segment) => (hasCard(s) ? (brisk(s) ? BRISK_CARD : CARD) : 0);
const holdOutOf = (s: Segment) => (brisk(s) ? BRISK_HOLD_OUT : HOLD_OUT);
const plays = all.map((s) => Math.round((s.length * FPS) / rateOf(s)));
const lengths = all.map((s, i) => (opensSection[i] ? SECTION : 0) + cardOf(s) + HOLD_IN + plays[i]! + holdOutOf(s));
const starts = lengths.map((_, i) => INTRO + lengths.slice(0, i).reduce((a, b) => a + b, 0));
const total = INTRO + lengths.reduce((a, b) => a + b, 0) + OUTRO;
const items = all.map((_, i) => all.slice(0, i + 1).filter(hasCard).length - 1);
const itemCount = all.filter(hasCard).length;
const sectionCounts = all.reduce<Record<string, number>>((acc, s) => (hasCard(s) ? { ...acc, [s.section]: (acc[s.section] ?? 0) + 1 } : acc), {});

export const meta = { width: 1920, height: 1080, fps: FPS, durationInFrames: total };

const label: CSSProperties = {
  fontFamily: font.mono,
  fontWeight: 460,
  fontStretch: "87.5%",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontSize: 20,
  color: color.ink2,
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Pointer = { x: number; y: number; pressed: boolean } | null;

function pointerAt(events: Event[], t: number): Pointer {
  let at: Event | null = null;
  let pressed = false;
  for (const e of events) {
    if (e.t > t) break;
    if (e.hide) at = null;
    else if (e.x !== undefined && e.y !== undefined) at = e;
    if (e.down) pressed = true;
    if (e.up) pressed = false;
  }
  return at ? { x: at.x ?? 0, y: at.y ?? 0, pressed } : null;
}

function useClipTime(clip: Clip, seg: Segment, play: number) {
  const frame = useCurrentFrame();
  return clip.inS + interpolate(frame, [HOLD_IN, HOLD_IN + play], [0, (play / FPS) * rateOf(seg)], clamp);
}

function Keycap({ events, t, right, top }: { events: Event[]; t: number; right: number; top: number }) {
  const shown = events.filter((e) => e.mark && t >= e.t && t < e.t + 1.3);
  if (!shown.length) return null;
  const e = shown[shown.length - 1]!;
  const k = t - e.t;
  const opacity = interpolate(k, [0, 0.12, 1.1, 1.3], [0, 1, 1, 0], clamp);
  const lift = interpolate(k, [0, 0.18], [8, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div
      style={{
        position: "absolute",
        left: right,
        top: top + lift,
        transform: "translate(-100%, -100%)",
        opacity,
        padding: "8px 16px",
        borderRadius: 10,
        background: color.ink,
        color: color.paper,
        fontFamily: font.poster,
        fontWeight: 760,
        fontSize: 26,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {e.mark}
    </div>
  );
}

function shownBetween(t: number, from: number, until: number | undefined) {
  if (t < from) return 0;
  const appear = interpolate(t, [from, from + 0.04], [0, 1], clamp);
  return until === undefined ? appear : appear * interpolate(t, [until, until + 0.15], [1, 0], clamp);
}

function NoteBubble({ note, t, cam, k }: { note: Note; t: number; cam: [number, number]; k: number }) {
  const opacity = shownBetween(t, note.t, note.until);
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        ...label,
        position: "absolute",
        left: (note.x - cam[0]) * k + 30,
        top: (note.y - cam[1]) * k + 12,
        opacity,
        fontSize: 22,
        fontWeight: 620,
        color: color.paper,
        background: color.ink,
        padding: "8px 14px 7px",
        borderRadius: 10,
        whiteSpace: "nowrap",
      }}
    >
      {note.text}
    </div>
  );
}

const BANNER = { w: 400, radius: 24, pad: 14, icon: 40, margin: 18 };

function NotificationBanner({ banner, t }: { banner: Banner; t: number }) {
  if (t < banner.t) return null;
  const k = interpolate(t, [banner.t, banner.t + 0.38], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const chip = interpolate(t, [banner.t + 0.45, banner.t + 0.7], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", right: BANNER.margin, top: BANNER.margin, width: BANNER.w, opacity: k, transform: `translateX(${(1 - k) * 60}px)` }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          padding: BANNER.pad,
          borderRadius: BANNER.radius,
          background: "rgb(246, 244, 245)",
          boxShadow: "0 16px 44px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.16)",
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          color: "rgba(0,0,0,0.85)",
        }}
      >
        <Img src={staticFile("brand/app-icon.png")} style={{ width: BANNER.icon, height: BANNER.icon, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
            <span>{banner.title}</span>
            <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(0,0,0,0.45)" }}>now</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{banner.subtitle}</div>
          <div style={{ fontSize: 14, lineHeight: 1.35, color: "rgba(0,0,0,0.75)" }}>{banner.body}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, opacity: chip }}>
        <div style={{ ...label, fontSize: 21, fontWeight: 620, color: color.paper, background: banner.silent ? color.blue : color.ink, padding: "8px 14px 7px", borderRadius: 10 }}>
          {banner.silent ? "No sound" : "Plays the alert sound"}
        </div>
      </div>
    </div>
  );
}

const MENU_LOOK = {
  radius: 12,
  font: 13,
  gutter: 20,
  icon: 16,
  iconGap: 6,
  highlightInset: 5,
  highlightRadius: 6,
  dark: { background: "rgba(44, 43, 46, 0.97)", text: "rgba(255, 255, 255, 0.88)", disabled: "rgba(255, 255, 255, 0.35)", rule: "rgba(255,255,255,0.14)", edge: "rgba(255,255,255,0.16)" },
  light: { background: "rgba(246, 245, 246, 0.97)", text: "rgba(0, 0, 0, 0.85)", disabled: "rgba(0, 0, 0, 0.3)", rule: "rgba(0,0,0,0.1)", edge: "rgba(0,0,0,0.14)" },
  highlight: "#0A64D8",
};

function rowsOf(list: MenuItem[], top: number, g: MenuGeometry) {
  let y = top + g.pad;
  return list.map((item) => {
    const h = item.separator ? g.separator : g.row;
    const row = { item, y, h };
    y += h;
    return row;
  });
}

function heightOf(list: MenuItem[], g: MenuGeometry) {
  return g.pad * 2 + list.reduce((sum, i) => sum + (i.separator ? g.separator : g.row), 0);
}

function inside(p: Pointer, x: number, y: number, w: number, h: number) {
  return !!p && p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
}

function MenuColumn({ list, x, y, width, g, hot, cam, k, light }: { list: MenuItem[]; x: number; y: number; width: number; g: MenuGeometry; hot: MenuItem | null; cam: [number, number]; k: number; light?: boolean }) {
  const look = light ? MENU_LOOK.light : MENU_LOOK.dark;
  const rows = rowsOf(list, y, g);
  return (
    <div
      style={{
        position: "absolute",
        left: (x - cam[0]) * k,
        top: (y - cam[1]) * k,
        width: width * k,
        height: heightOf(list, g) * k,
        borderRadius: MENU_LOOK.radius * k,
        background: look.background,
        boxShadow: `0 ${10 * k}px ${30 * k}px rgba(0,0,0,0.45), 0 0 0 ${0.5 * k}px ${look.edge}`,
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        fontSize: MENU_LOOK.font * k,
        color: look.text,
      }}
    >
      {rows.map(({ item, y: ry, h }, i) =>
        item.separator ? (
          <div key={i} style={{ position: "absolute", left: 10 * k, right: 10 * k, top: (ry - y + h / 2) * k, height: Math.max(1, 0.5 * k), background: look.rule }} />
        ) : (
          <div
            key={i}
            style={{
              position: "absolute",
              left: MENU_LOOK.highlightInset * k,
              right: MENU_LOOK.highlightInset * k,
              top: (ry - y) * k,
              height: h * k,
              borderRadius: MENU_LOOK.highlightRadius * k,
              background: hot === item && !item.disabled ? MENU_LOOK.highlight : "transparent",
              color: item.disabled ? look.disabled : hot === item ? "#FFFFFF" : look.text,
              display: "flex",
              alignItems: "center",
            }}
          >
            <div style={{ width: (MENU_LOOK.gutter - MENU_LOOK.highlightInset) * k, textAlign: "center", fontSize: 11 * k, fontWeight: 600 }}>{item.checked ? "✓" : ""}</div>
            {item.symbol ? <Img src={staticFile(`${SYMBOLS}/${item.symbol}.png`)} style={{ width: MENU_LOOK.icon * k, height: MENU_LOOK.icon * k, marginRight: MENU_LOOK.iconGap * k, filter: light ? "invert(1)" : "none", opacity: item.disabled ? 0.4 : 1 }} /> : null}
            <div style={{ flex: 1, whiteSpace: "nowrap" }}>{item.title}</div>
            {item.children ? <div style={{ paddingRight: 8 * k, fontSize: 12 * k, opacity: 0.7 }}>›</div> : null}
          </div>
        ),
      )}
    </div>
  );
}

function MenuReplica({ menu, t, p, cam, k }: { menu: Menu; t: number; p: Pointer; cam: [number, number]; k: number }) {
  if (t < menu.t || t > menu.until + 0.2) return null;
  const g = menu.geometry;
  const opacity = interpolate(t, [menu.t, menu.t + 0.05, menu.until + 0.05, menu.until + 0.2], [0, 1, 1, 0], clamp);
  const parent = menu.items.find((i) => i.open) ?? null;
  const children = parent?.children ?? [];
  const subOpen = menu.sub !== null && t >= menu.sub;
  const hotIn = (list: MenuItem[], x: number, top: number, width: number) => rowsOf(list, top, g).find(({ item, y, h }) => !item.separator && inside(p, x, y, width, h))?.item ?? null;
  const subHot = subOpen ? hotIn(children, g.subX, g.subY, g.subWidth) : null;
  const mainHot = subOpen ? parent : hotIn(menu.items, g.x, g.y, g.width);
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <MenuColumn list={menu.items} x={g.x} y={g.y} width={g.width} g={g} hot={mainHot} cam={cam} k={k} light={menu.light} />
      {subOpen ? <MenuColumn list={children} x={g.subX} y={g.subY} width={g.subWidth} g={g} hot={subHot} cam={cam} k={k} light={menu.light} /> : null}
      <div style={{ ...label, position: "absolute", right: 14, top: 14, fontSize: 18, fontWeight: 620, color: color.paper, background: color.ink, padding: "7px 12px 6px", borderRadius: 9 }}>{menu.caption ?? "Menu drawn from Ardia's log"}</div>
    </div>
  );
}

const PANE_LOOK = {
  editor: { background: "#FBFAF7", bar: "#ECE8E0", text: "#1E1B17", dim: "#8A8378", title: "#57524A" },
  terminal: { background: "#16130F", bar: "#2A2621", text: "#EFE8DC", dim: "#A79F93", title: "#A79F93" },
};

function PaneCard({ pane, t, cam, k }: { pane: Pane; t: number; cam: [number, number]; k: number }) {
  const opacity = shownBetween(t, pane.t, pane.until);
  if (opacity <= 0) return null;
  const look = PANE_LOOK[pane.style];
  const lines = pane.lines.filter((l) => t >= l.t);
  const savedFlash = pane.saved !== undefined && t >= pane.saved ? interpolate(t, [pane.saved, pane.saved + 0.1, pane.saved + 1.4, pane.saved + 1.7], [0, 1, 1, 0], clamp) : 0;
  const size = pane.style === "terminal" ? Math.max(11, 8 * k) : Math.max(13, 9 * k);
  return (
    <div
      style={{
        position: "absolute",
        left: (pane.x - cam[0]) * k,
        top: (pane.y - cam[1]) * k,
        width: pane.w * k,
        opacity,
        borderRadius: 12,
        overflow: "hidden",
        background: look.background,
        boxShadow: "0 18px 44px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 12px", background: look.bar }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <div key={c} style={{ width: 11, height: 11, borderRadius: 6, background: c }} />
        ))}
        <div style={{ ...label, marginLeft: 10, fontSize: 15, color: look.title, textTransform: "none", letterSpacing: "0.01em" }}>{pane.title}</div>
        <div style={{ flex: 1 }} />
        <div style={{ ...label, fontSize: 14, fontWeight: 620, color: color.paper, background: color.blue, padding: "4px 9px 3px", borderRadius: 7, opacity: savedFlash }}>Saved</div>
      </div>
      <div style={{ padding: "10px 14px 12px", fontFamily: font.mono, fontSize: size, lineHeight: 1.42, color: look.text, whiteSpace: "pre" }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.dim ? look.dim : look.text }}>
            {l.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function boxFor(seg: Segment) {
  const [, , cw, ch] = seg.cam as [number, number, number, number];
  const max = seg.layout === "stack" ? STACK_BOX : seg.layout === "solo" ? SOLO_BOX : SIDE_BOX;
  const k = Math.min(max.w / cw, max.h / ch);
  return { w: Math.round(cw * k), h: Math.round(ch * k), k };
}

function Footage({ clip, seg, play }: { clip: Clip; seg: Segment; play: number }) {
  const frame = useCurrentFrame();
  const rate = rateOf(seg);
  const t = clip.inS + interpolate(frame, [HOLD_IN, HOLD_IN + play], [0, (play / FPS) * rate], clamp);
  const { w: boxW } = boxFor(seg);
  const zoomed = seg.zoom ? interpolate(t - clip.inS, [seg.zoom.from, seg.zoom.to], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 0;
  const camAt = (i: number) => seg.cam[i]! + ((seg.zoom?.cam[i] ?? seg.cam[i]!) - seg.cam[i]!) * zoomed;
  const [cx, cy, cw] = [camAt(0), camAt(1), camAt(2)];
  const k = boxW / cw;
  const p = seg.cursor === false ? null : pointerAt(clip.events, t);
  const cursorScale = k / CURSOR_PX_PER_PT;
  const place: CSSProperties = { position: "absolute", left: -cx * k, top: -cy * k, width: (clip.w / clip.scale) * k, height: (clip.h / clip.scale) * k, maxWidth: "none" };
  const video = clip.file ? <OffthreadVideo src={staticFile(clip.file)} startFrom={Math.round(clip.inS * FPS)} endAt={Math.round(clip.outS * FPS) + 2} muted playbackRate={rate} style={place} /> : null;
  return (
    <>
      {video ? (
        <>
          <Sequence durationInFrames={HOLD_IN} layout="none">
            <Freeze frame={0}>{video}</Freeze>
          </Sequence>
          <Sequence from={HOLD_IN} durationInFrames={play} layout="none">
            {video}
          </Sequence>
          <Sequence from={HOLD_IN + play} layout="none">
            <Freeze frame={play - 1}>{video}</Freeze>
          </Sequence>
        </>
      ) : (
        <Img src={staticFile(clip.still ?? "")} style={{ ...place, imageRendering: "auto" }} />
      )}
      {(clip.menus ?? []).map((m) => (
        <MenuReplica key={`${m.t}`} menu={m} t={t} p={p} cam={[cx, cy]} k={k} />
      ))}
      {(clip.banners ?? []).map((b) => (
        <NotificationBanner key={`${b.t}`} banner={b} t={t} />
      ))}
      {(clip.notes ?? []).map((n) => (
        <NoteBubble key={`${n.t}`} note={n} t={t} cam={[cx, cy]} k={k} />
      ))}
      {p ? (
        <Img
          src={staticFile("brand/cursor-arrow.png")}
          style={{
            position: "absolute",
            left: (p.x - cx) * k - CURSOR_TIP.x * cursorScale,
            top: (p.y - cy) * k - CURSOR_TIP.y * cursorScale,
            width: 112 * cursorScale,
            height: 160 * cursorScale,
            transform: `scale(${p.pressed ? 0.86 : 1})`,
            transformOrigin: `${CURSOR_TIP.x / 1.12}% ${CURSOR_TIP.y / 1.6}%`,
          }}
        />
      ) : null}
      {(clip.panes ?? []).map((pane) => (
        <PaneCard key={`${pane.t}-${pane.title}`} pane={pane} t={t} cam={[cx, cy]} k={k} />
      ))}
    </>
  );
}

function SideLabel({ after, version, style }: { after: boolean; version?: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, ...style }}>
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
        {after ? "After" : "Before"}
      </div>
      <div style={{ ...label, fontSize: 18 }}>{version ?? (after ? RELEASE : BEFORE_VERSION)}</div>
    </div>
  );
}

type Place = { left: number; top: number; w: number; h: number };

function placements(seg: Segment): [Place, Place] {
  const { w, h } = boxFor(seg);
  if (seg.layout === "stack") {
    const gap = 74;
    const top = AREA.top + Math.max(0, (AREA.bottom - AREA.top - (2 * h + gap)) / 2) + 30;
    const left = (1920 - w) / 2;
    return [
      { left, top, w, h },
      { left, top: top + h + gap, w, h },
    ];
  }
  if (seg.layout === "solo") {
    const solo = { left: (1920 - w) / 2, top: AREA.top + Math.max(0, (SOLO_BOX.h - h) / 2), w, h };
    return [solo, solo];
  }
  const top = AREA.top + Math.max(0, (SIDE_BOX.h - h) / 2);
  return [
    { left: LEFT + (SIDE_BOX.w - w) / 2, top, w, h },
    { left: RIGHT + (SIDE_BOX.w - w) / 2, top, w, h },
  ];
}

const panelStyle = (place: Place): CSSProperties => ({
  position: "absolute",
  left: place.left,
  top: place.top,
  width: place.w,
  height: place.h,
  overflow: "hidden",
  borderRadius: 18,
  background: color.paperDeep,
  boxShadow: "0 30px 70px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
});

function Panel({ clip, seg, play, place, after }: { clip: Clip; seg: Segment; play: number; place: Place; after: boolean }) {
  const t = useClipTime(clip, seg, play);
  return (
    <>
      <Keycap events={clip.events} t={t} right={place.left + place.w} top={place.top - 10} />
      <SideLabel after={after} version={after ? seg.afterVersion : seg.beforeVersion} style={{ position: "absolute", left: place.left, top: place.top - 46 }} />
      <div style={panelStyle(place)}>
        <Footage clip={clip} seg={seg} play={play} />
      </div>
    </>
  );
}

function AfterOnlyNote({ text, place, version }: { text: string; place: Place; version?: string }) {
  return (
    <>
      <SideLabel after={false} version={version} style={{ position: "absolute", left: place.left, top: place.top - 46 }} />
      <div style={{ ...panelStyle(place), display: "flex", alignItems: "center", justifyContent: "center", padding: 80, boxSizing: "border-box" }}>
        <div style={{ fontFamily: font.serif, fontSize: 34, lineHeight: 1.32, color: color.ink2, textAlign: "center" }}>{text}</div>
      </div>
    </>
  );
}

function NotFilmed({ reason }: { reason: string }) {
  const place = { left: LEFT, top: AREA.top + 60, w: 1800, h: 520 };
  return (
    <div style={{ ...panelStyle(place), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 160px", boxSizing: "border-box", gap: 28 }}>
      <div style={{ ...label, fontSize: 22, fontWeight: 620, color: color.paper, background: color.ink, padding: "8px 14px 7px", borderRadius: 10 }}>Not filmed</div>
      <div style={{ fontFamily: font.serif, fontSize: 36, lineHeight: 1.34, color: color.ink2, textAlign: "center" }}>{reason}</div>
    </div>
  );
}

const number = (i: number) => `${String(items[i]! + 1).padStart(2, "0")} / ${String(itemCount).padStart(2, "0")}`;

function speedOf(seg: Segment) {
  const speed = seg.rate ? `${SPEED_NAMES[seg.rate] ?? `${seg.rate}×`} · ` : "";
  return `${speed}${seg.note ? `${seg.note} · ` : ""}`;
}

function SectionCard({ section }: { section: Section }) {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 18], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 26], [24, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [SECTION - 14, SECTION], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 24, color: color.blue, ...rise(0) }}>
        {sectionCounts[section]} {sectionCounts[section] === 1 ? "change" : "changes"}
      </div>
      <div style={{ marginTop: 14, fontFamily: font.poster, fontWeight: 860, fontStretch: "75%", textTransform: "uppercase", fontSize: 190, lineHeight: 0.9, color: section === "New" ? color.stamp : color.ink, ...rise(4) }}>
        {section}
      </div>
      <div style={{ marginTop: 22, fontFamily: font.serif, fontSize: 36, color: color.ink2, ...rise(10) }}>{SECTION_LINES[section]}</div>
    </AbsoluteFill>
  );
}

function Card({ seg, index, length }: { seg: Segment; index: number; length: number }) {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 16], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 24], [20, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [length - 14, length], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ display: "flex", gap: 28, alignItems: "center", ...rise(0) }}>
        <div style={{ ...label, fontSize: 24, color: seg.section === "New" ? color.stamp : color.ink }}>{seg.section}</div>
        <div style={{ ...label, fontSize: 24, color: color.ink2 }}>·</div>
        <div style={{ ...label, fontSize: 24, color: color.blue }}>Change {number(index)}</div>
      </div>
      <div
        style={{
          marginTop: 26,
          maxWidth: 1560,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          fontSize: brisk(seg) ? 88 : 104,
          lineHeight: 0.95,
          color: color.ink,
          ...rise(5),
        }}
      >
        {seg.title}
      </div>
      {seg.rate || seg.note ? <div style={{ ...label, marginTop: 30, fontSize: 20, ...rise(10) }}>{speedOf(seg).replace(/ · $/, "")}</div> : null}
    </AbsoluteFill>
  );
}

function Shot({ seg, index, play }: { seg: Segment; index: number; play: number }) {
  const frame = useCurrentFrame();
  const length = HOLD_IN + play + holdOutOf(seg);
  const fade = interpolate(frame, [0, 14, length - 12, length], [0, 1, 1, 0], clamp);
  const [before, after] = placements(seg);
  const solo = seg.layout === "solo";
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: LEFT, top: 40, right: 60, display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...label, color: color.ink }}>
          Ardia {RELEASE} · {seg.section}
        </div>
        <div style={{ ...label, color: color.blue }}>
          {speedOf(seg)}Change {number(index)}
        </div>
      </div>
      <div style={{ position: "absolute", left: LEFT, top: 84, width: 860, fontFamily: font.poster, fontWeight: 850, fontStretch: "75%", textTransform: "uppercase", letterSpacing: "0.02em", fontSize: 54, lineHeight: 0.98, color: color.ink }}>
        {seg.title}
      </div>
      <div style={{ position: "absolute", left: RIGHT, top: 84, width: 880, fontFamily: font.serif, fontSize: 27, lineHeight: 1.3, color: color.ink }}>{seg.body}</div>
      {seg.kind === "text" ? (
        <NotFilmed reason={seg.reason ?? ""} />
      ) : (
        <>
          {solo ? null : seg.before ? <Panel clip={seg.before} seg={seg} play={play} place={before} after={false} /> : <AfterOnlyNote text={seg.afterOnly ?? ""} place={before} version={seg.beforeVersion} />}
          {seg.after ? <Panel clip={seg.after} seg={seg} play={play} place={after} after /> : null}
        </>
      )}
    </AbsoluteFill>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 32], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 44], [28, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [INTRO - 20, INTRO], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(4) }}>Stable · before and after</div>
      <div style={{ marginTop: 20, fontFamily: font.poster, fontWeight: 860, fontStretch: "75%", fontSize: 230, lineHeight: 0.9, color: color.ink, ...rise(12) }}>Ardia</div>
      <div style={{ marginTop: 18, fontFamily: font.poster, fontWeight: 700, fontStretch: "87.5%", fontSize: 92, color: color.stamp, ...rise(24) }}>{RELEASE}</div>
      <div style={{ marginTop: 22, fontFamily: font.serif, fontSize: 36, color: color.ink2, ...rise(32) }}>
        Every change since {BEFORE_VERSION}, on {BEFORE_VERSION} and on the new release.
      </div>
      <Img src={staticFile("brand/app-icon.png")} style={{ position: "absolute", right: 170, top: 300, width: 480, height: 480, ...rise(20) }} />
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 24], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity }}>
      <Img src={staticFile("brand/app-icon.png")} style={{ width: 200, height: 200 }} />
      <div style={{ marginTop: 28, fontFamily: font.poster, fontWeight: 760, fontStretch: "87.5%", fontSize: 60, color: color.ink }}>Ardia {RELEASE}</div>
      <div style={{ ...label, marginTop: 18, fontSize: 24, color: color.blue }}>ardia.dev</div>
    </AbsoluteFill>
  );
}

function Scene({ seg, index }: { seg: Segment; index: number }) {
  const section = opensSection[index] ? SECTION : 0;
  const card = cardOf(seg);
  return (
    <>
      {section ? (
        <Sequence durationInFrames={section}>
          <SectionCard section={seg.section} />
        </Sequence>
      ) : null}
      {card ? (
        <Sequence from={section} durationInFrames={card}>
          <Card seg={seg} index={index} length={card} />
        </Sequence>
      ) : null}
      <Sequence from={section + card} durationInFrames={lengths[index]! - section - card}>
        <Shot seg={seg} index={index} play={plays[index]!} />
      </Sequence>
    </>
  );
}

export default function Video() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      {all.map((seg, i) => (
        <Sequence key={`${seg.scene}-${i}`} from={starts[i]} durationInFrames={lengths[i]}>
          <Scene seg={seg} index={i} />
        </Sequence>
      ))}
      <Sequence from={total - OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
