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

interface Overlay {
  file: string;
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MenuItem {
  title?: string;
  symbol?: string;
  key?: string;
  sep?: boolean;
  disabled?: boolean;
  checked?: boolean;
  submenu?: boolean;
}

interface Menu {
  t: number;
  until?: number;
  x: number;
  y: number;
  up?: boolean;
  items: MenuItem[];
}

interface Note {
  t: number;
  until?: number;
  x: number;
  y: number;
  text: string;
}

interface Guide {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Clip {
  file?: string;
  still?: string;
  menus?: Menu[];
  notes?: Note[];
  guides?: Guide[];
  overlays?: Overlay[];
  w: number;
  h: number;
  scale: number;
  inS: number;
  outS: number;
  events: Event[];
}

interface Segment {
  scene: string;
  title: string;
  body: string;
  layout?: "side" | "stack";
  cam: number[];
  tiles?: number[][];
  tileNotes?: { before: string[]; after: string[] };
  length: number;
  rate?: number;
  afterVersion?: string;
  note?: string;
  cursor?: boolean;
  afterOnly?: string;
  before?: Clip;
  after: Clip;
}

const FPS = 60;
const INTRO = Math.round(2.6 * FPS);
const CARD = Math.round(1.4 * FPS);
const HOLD_IN = Math.round(0.5 * FPS);
const HOLD_OUT = Math.round(1.0 * FPS);
const OUTRO = Math.round(2.4 * FPS);
const AREA = { top: 250, bottom: 1040 };
const SIDE_BOX = { w: 880, h: AREA.bottom - AREA.top };
const STACK_BOX = { w: 1800, h: 330 };
const LEFT = 60;
const RIGHT = 980;
const CURSOR_PX_PER_PT = 2.72;
const CURSOR_TIP = { x: 18, y: 16 };
const OVERLAY_RADIUS = 12;
const VERSION = "0.2.43-nightly.3";
const RELEASE = "0.2.43-nightly.3";
const BEFORE_VERSION = "0.2.43-nightly.2";
const SPEED_NAMES: Record<number, string> = { 0.5: "Half speed", 0.25: "Quarter speed", 0.125: "Eighth speed" };

const all = segments as Segment[];
const rateOf = (s: Segment) => s.rate ?? 1;
const plays = all.map((s) => Math.round((s.length * FPS) / rateOf(s)));
const lengths = plays.map((p) => CARD + HOLD_IN + p + HOLD_OUT);
const starts = lengths.map((_, i) => INTRO + lengths.slice(0, i).reduce((a, b) => a + b, 0));
const total = INTRO + lengths.reduce((a, b) => a + b, 0) + OUTRO;

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

function pointerAt(events: Event[], t: number) {
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

const TILE_GAP = 8;
const GUIDE = "rgba(120, 200, 255, 0.95)";
const MENU = {
  row: 24,
  separator: 11,
  padY: 5,
  padRight: 17,
  radius: 13,
  font: 13,
  stateX: 16,
  iconX: 22.5,
  iconXWithState: 35,
  textX: 16,
  textXWithIcon: 38,
  textXWithState: 34,
  textXWithBoth: 50,
};
const MENU_TEXT = "rgba(255, 255, 255, 0.88)";
const MENU_DIM = "rgba(255, 255, 255, 0.27)";
const MENU_KEY = "rgba(255, 255, 255, 0.40)";
const SYMBOL_SIZE: Record<string, [number, number]> = {
  bookmark: [13, 16],
  checkmark: [15, 13],
  "chevron.right": [10, 14],
  folder: [19, 14],
  "folder.badge.minus": [20, 15],
  "folder.badge.plus": [20, 15],
  gearshape: [16, 16],
  "hand.raised": [16, 16],
  link: [17, 17],
  macwindow: [19, 14],
  paintpalette: [18, 15],
  pencil: [13, 13],
  person: [16, 14],
  photo: [19, 14],
  pin: [16, 17],
  plus: [15, 13],
  "plus.app": [16, 14],
  "plus.square.on.square": [18, 16],
  "rectangle.split.2x1": [19, 14],
  "sidebar.left": [19, 14],
  "speaker.slash": [14, 16],
  trash: [15, 17],
  xmark: [15, 13],
};
const symbolFile = (name: string) => staticFile(`footage/fixes-0243n3/sym/${name}.png`);

function shownBetween(t: number, from: number, until: number | undefined) {
  if (t < from) return 0;
  const appear = interpolate(t, [from, from + 0.04], [0, 1], clamp);
  return until === undefined ? appear : appear * interpolate(t, [until, until + 0.15], [1, 0], clamp);
}

function MenuSymbol({ name, x, k, dim, scale = 1 }: { name: string; x: number; k: number; dim: boolean; scale?: number }) {
  const [sw, sh] = SYMBOL_SIZE[name] ?? [16, 16];
  return (
    <Img
      src={symbolFile(name)}
      style={{
        position: "absolute",
        left: (x - (sw * scale) / 2) * k,
        top: ((MENU.row - sh * scale) / 2) * k,
        width: sw * scale * k,
        height: sh * scale * k,
        opacity: dim ? 0.3 : 0.88,
      }}
    />
  );
}

function MenuReplica({ menu, t, cam, k }: { menu: Menu; t: number; cam: [number, number]; k: number }) {
  const opacity = shownBetween(t, menu.t, menu.until);
  if (opacity <= 0) return null;
  const hasIcon = menu.items.some((i) => i.symbol);
  const hasState = menu.items.some((i) => i.checked);
  const textX = hasIcon ? (hasState ? MENU.textXWithBoth : MENU.textXWithIcon) : hasState ? MENU.textXWithState : MENU.textX;
  const iconX = hasState ? MENU.iconXWithState : MENU.iconX;
  return (
    <div
      style={{
        position: "absolute",
        left: (menu.x - cam[0]) * k,
        top: (menu.y - cam[1]) * k,
        transform: menu.up ? "translateY(-100%)" : undefined,
        opacity,
        display: "inline-block",
        padding: `${MENU.padY * k}px 0`,
        minWidth: 190 * k,
        borderRadius: MENU.radius * k,
        background: "rgba(84, 76, 79, 0.86)",
        backdropFilter: `blur(${22 * k}px) saturate(1.6)`,
        boxShadow: `0 ${10 * k}px ${34 * k}px rgba(0,0,0,0.38), 0 0 0 ${0.5 * k}px rgba(0,0,0,0.55), inset 0 0 0 ${0.75 * k}px rgba(255,255,255,0.14)`,
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        fontSize: MENU.font * k,
        letterSpacing: "-0.005em",
        whiteSpace: "nowrap",
        color: MENU_TEXT,
      }}
    >
      {menu.items.map((item, i) =>
        item.sep ? (
          <div key={i} style={{ height: MENU.separator * k, display: "flex", alignItems: "center", padding: `0 ${16 * k}px` }}>
            <div style={{ flex: 1, height: Math.max(1, 0.75 * k), background: "rgba(255,255,255,0.13)" }} />
          </div>
        ) : (
          <div key={i} style={{ position: "relative", height: MENU.row * k, display: "flex", alignItems: "center", paddingLeft: textX * k, paddingRight: MENU.padRight * k }}>
            {item.checked ? <MenuSymbol name="checkmark" x={MENU.stateX} k={k} dim={!!item.disabled} scale={0.78} /> : null}
            {item.symbol ? <MenuSymbol name={item.symbol} x={iconX} k={k} dim={!!item.disabled} /> : null}
            <div style={{ flex: 1, color: item.disabled ? MENU_DIM : MENU_TEXT }}>{item.title}</div>
            {item.key ? (
              <div style={{ marginLeft: 30 * k, display: "flex", gap: 1.5 * k, color: item.disabled ? MENU_DIM : MENU_KEY }}>
                {[...item.key].map((g, j) => (
                  <span key={j} style={{ display: "inline-block", minWidth: 9 * k, textAlign: "center" }}>
                    {g}
                  </span>
                ))}
              </div>
            ) : null}
            {item.submenu ? (
              <div style={{ position: "relative", marginLeft: 30 * k, width: 8 * k, height: MENU.row * k }}>
                <MenuSymbol name="chevron.right" x={4} k={k} dim={!!item.disabled} scale={0.72} />
              </div>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
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

function boxFor(seg: Segment, within?: { w: number; h: number }) {
  const [, , cw, ch] = seg.cam as [number, number, number, number];
  const max = within ?? (seg.layout === "stack" ? STACK_BOX : SIDE_BOX);
  const k = Math.min(max.w / cw, max.h / ch);
  return { w: Math.round(cw * k), h: Math.round(ch * k), k };
}

function Footage({ clip, seg, play, within }: { clip: Clip; seg: Segment; play: number; within?: { w: number; h: number } }) {
  const frame = useCurrentFrame();
  const [cx, cy] = seg.cam as [number, number];
  const { k } = boxFor(seg, within);
  const rate = rateOf(seg);
  const t = clip.inS + interpolate(frame, [HOLD_IN, HOLD_IN + play], [0, (play / FPS) * rate], clamp);
  const p = seg.cursor === false ? null : pointerAt(clip.events, t);
  const cursorScale = k / CURSOR_PX_PER_PT;
  const place: CSSProperties = { position: "absolute", left: -cx * k, top: -cy * k, width: (clip.w / clip.scale) * k, height: (clip.h / clip.scale) * k, maxWidth: "none" };
  const video = clip.file ? (
    <OffthreadVideo
      src={staticFile(clip.file)}
      startFrom={Math.round(clip.inS * FPS)}
      endAt={Math.round(clip.outS * FPS) + 2}
      muted
      playbackRate={rate}
      style={place}
    />
  ) : null;
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
      {(clip.overlays ?? []).map((o) => (
        <OverlayWindow key={o.file} overlay={o} clip={clip} cam={[cx, cy]} k={k} play={play} rate={rate} />
      ))}
      {(clip.guides ?? []).map((g) => (
        <div
          key={`${g.x},${g.y}`}
          style={{
            position: "absolute",
            left: (g.x - cx) * k,
            top: (g.y - cy) * k,
            width: g.w * k,
            height: g.h * k,
            boxSizing: "border-box",
            border: `2px dashed ${GUIDE}`,
            borderRadius: 7 * k,
          }}
        />
      ))}
      {(clip.menus ?? []).map((m) => (
        <MenuReplica key={`${m.t}`} menu={m} t={t} cam={[cx, cy]} k={k} />
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
    </>
  );
}

function OverlayWindow({ overlay, clip, cam, k, play, rate }: { overlay: Overlay; clip: Clip; cam: [number, number]; k: number; play: number; rate: number }) {
  const from = HOLD_IN + Math.round((Math.max(0, overlay.t - clip.inS) / rate) * FPS);
  const shown = HOLD_IN + play - from;
  if (shown <= 0) return null;
  const video = <OffthreadVideo src={staticFile(overlay.file)} startFrom={Math.round(Math.max(0, clip.inS - overlay.t) * FPS)} muted playbackRate={rate} style={{ width: "100%", height: "100%" }} />;
  const frame: CSSProperties = {
    position: "absolute",
    left: (overlay.x - cam[0]) * k,
    top: (overlay.y - cam[1]) * k,
    width: overlay.w * k,
    height: overlay.h * k,
    borderRadius: OVERLAY_RADIUS * k,
    overflow: "hidden",
    boxShadow: `0 ${18 * k}px ${40 * k}px rgba(0,0,0,0.28), 0 0 0 ${k}px rgba(0,0,0,0.12)`,
  };
  return (
    <>
      <Sequence from={from} durationInFrames={shown} layout="none">
        <div style={frame}>{video}</div>
      </Sequence>
      <Sequence from={from + shown} layout="none">
        <div style={frame}>
          <Freeze frame={shown - 1}>{video}</Freeze>
        </div>
      </Sequence>
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
      <div style={{ ...label, fontSize: 18 }}>{after ? (version ?? VERSION) : BEFORE_VERSION}</div>
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

function Tiles({ clip, seg, play, place, notes }: { clip: Clip; seg: Segment; play: number; place: Place; notes: string[] }) {
  const tile = { w: (place.w - TILE_GAP) / 2, h: (place.h - TILE_GAP) / 2 };
  return (
    <>
      {(seg.tiles ?? []).map((cam, i) => (
        <div
          key={cam.join(",")}
          style={{ position: "absolute", left: (i % 2) * (tile.w + TILE_GAP), top: Math.floor(i / 2) * (tile.h + TILE_GAP), width: tile.w, height: tile.h, overflow: "hidden", background: color.paperDeep }}
        >
          <Footage clip={clip} seg={{ ...seg, cam }} play={play} within={tile} />
          {notes[i] ? (
            <div
              style={{
                ...label,
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                fontSize: 22,
                fontWeight: 620,
                color: color.paper,
                background: color.ink,
                padding: "8px 14px 7px",
                borderRadius: 10,
                whiteSpace: "nowrap",
              }}
            >
              {notes[i]}
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

function Panel({ clip, seg, play, place, after }: { clip: Clip; seg: Segment; play: number; place: Place; after: boolean }) {
  const t = useClipTime(clip, seg, play);
  return (
    <>
      <Keycap events={clip.events} t={t} right={place.left + place.w} top={place.top - 10} />
      <SideLabel after={after} version={seg.afterVersion} style={{ position: "absolute", left: place.left, top: place.top - 46 }} />
      <div style={panelStyle(place)}>
        {seg.tiles ? (
          <Tiles clip={clip} seg={seg} play={play} place={place} notes={(after ? seg.tileNotes?.after : seg.tileNotes?.before) ?? []} />
        ) : (
          <Footage clip={clip} seg={seg} play={play} />
        )}
      </div>
    </>
  );
}

function AfterOnlyNote({ text, place }: { text: string; place: Place }) {
  return (
    <>
      <SideLabel after={false} style={{ position: "absolute", left: place.left, top: place.top - 46 }} />
      <div style={{ ...panelStyle(place), display: "flex", alignItems: "center", justifyContent: "center", padding: 80, boxSizing: "border-box" }}>
        <div style={{ fontFamily: font.serif, fontSize: 34, lineHeight: 1.32, color: color.ink2, textAlign: "center" }}>{text}</div>
      </div>
    </>
  );
}

const number = (i: number) => `${String(i + 1).padStart(2, "0")} / ${String(all.length).padStart(2, "0")}`;

function speedOf(seg: Segment) {
  const speed = seg.rate ? `${SPEED_NAMES[seg.rate] ?? `${seg.rate}×`} · ` : "";
  return `${speed}${seg.note ? `${seg.note} · ` : ""}`;
}

function Card({ seg, index }: { seg: Segment; index: number }) {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 20], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 28], [20, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [CARD - 16, CARD], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ display: "flex", gap: 28, alignItems: "center", ...rise(0) }}>
        <div style={{ ...label, fontSize: 24, color: color.ink }}>Before {BEFORE_VERSION}</div>
        <div style={{ ...label, fontSize: 24, color: color.ink2 }}>→</div>
        <div style={{ ...label, fontSize: 24, color: color.blue }}>After {seg.afterVersion ?? VERSION}</div>
      </div>
      <div
        style={{
          marginTop: 26,
          maxWidth: 1500,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          fontSize: 104,
          lineHeight: 0.95,
          color: color.ink,
          ...rise(6),
        }}
      >
        {seg.title}
      </div>
      <div style={{ ...label, marginTop: 30, fontSize: 20, ...rise(12) }}>
        {speedOf(seg)}Fix {number(index)}
      </div>
    </AbsoluteFill>
  );
}

function Shot({ seg, index, play }: { seg: Segment; index: number; play: number }) {
  const frame = useCurrentFrame();
  const length = HOLD_IN + play + HOLD_OUT;
  const fade = interpolate(frame, [0, 16, length - 12, length], [0, 1, 1, 0], clamp);
  const [before, after] = placements(seg);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: LEFT, top: 40, right: 60, display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...label, color: color.ink }}>Ardia {RELEASE} · before and after</div>
        <div style={{ ...label, color: color.blue }}>
          {speedOf(seg)}Fix {number(index)}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: 84,
          width: 860,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          fontSize: 54,
          lineHeight: 0.98,
          color: color.ink,
        }}
      >
        {seg.title}
      </div>
      <div style={{ position: "absolute", left: RIGHT, top: 84, width: 880, fontFamily: font.serif, fontSize: 27, lineHeight: 1.3, color: color.ink }}>{seg.body}</div>
      {seg.before ? <Panel clip={seg.before} seg={seg} play={play} place={before} after={false} /> : <AfterOnlyNote text={seg.afterOnly ?? ""} place={before} />}
      <Panel clip={seg.after} seg={seg} play={play} place={after} after />
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
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(4) }}>Nightly · before and after</div>
      <div style={{ marginTop: 20, fontFamily: font.poster, fontWeight: 860, fontStretch: "75%", fontSize: 230, lineHeight: 0.9, color: color.ink, ...rise(12) }}>
        Ardia
      </div>
      <div style={{ marginTop: 18, fontFamily: font.poster, fontWeight: 700, fontStretch: "87.5%", fontSize: 92, color: color.stamp, ...rise(24) }}>{RELEASE}</div>
      <div style={{ marginTop: 22, fontFamily: font.serif, fontSize: 36, color: color.ink2, ...rise(32) }}>
        The same clicks on {BEFORE_VERSION} and on the new nightly.
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

export default function Video() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      {all.map((seg, i) => (
        <Sequence key={seg.scene} from={starts[i]} durationInFrames={lengths[i]}>
          <Sequence durationInFrames={CARD}>
            <Card seg={seg} index={i} />
          </Sequence>
          <Sequence from={CARD} durationInFrames={lengths[i]! - CARD}>
            <Shot seg={seg} index={i} play={plays[i]!} />
          </Sequence>
        </Sequence>
      ))}
      <Sequence from={total - OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
