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

interface Clip {
  file: string;
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
const VERSION = "0.2.43-nightly.1";
const RELEASE = "0.2.43-nightly.1 and .2";
const BEFORE_VERSION = "0.2.42";
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

function Keycap({ events, t, width, height }: { events: Event[]; t: number; width: number; height: number }) {
  const shown = events.filter((e) => e.mark && t >= e.t && t < e.t + 1.3);
  if (!shown.length) return null;
  const e = shown[shown.length - 1]!;
  const k = t - e.t;
  const opacity = interpolate(k, [0, 0.12, 1.1, 1.3], [0, 1, 1, 0], clamp);
  const lift = interpolate(k, [0, 0.18], [12, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const small = height < 300;
  return (
    <div
      style={{
        position: "absolute",
        left: small ? width - 24 : width / 2,
        top: small ? height / 2 - 28 + lift : height - 96 + lift,
        transform: small ? "translateX(-100%)" : "translateX(-50%)",
        opacity,
        padding: "12px 22px",
        borderRadius: 14,
        background: color.ink,
        color: color.paper,
        fontFamily: font.poster,
        fontWeight: 760,
        fontSize: 36,
        lineHeight: 1,
        whiteSpace: "nowrap",
        boxShadow: "0 18px 40px rgba(22,19,15,0.28)",
      }}
    >
      {e.mark}
    </div>
  );
}

const TILE_GAP = 8;

function boxFor(seg: Segment, within?: { w: number; h: number }) {
  const [, , cw, ch] = seg.cam as [number, number, number, number];
  const max = within ?? (seg.layout === "stack" ? STACK_BOX : SIDE_BOX);
  const k = Math.min(max.w / cw, max.h / ch);
  return { w: Math.round(cw * k), h: Math.round(ch * k), k };
}

function Footage({ clip, seg, play, within }: { clip: Clip; seg: Segment; play: number; within?: { w: number; h: number } }) {
  const frame = useCurrentFrame();
  const [cx, cy] = seg.cam as [number, number];
  const { w, h, k } = boxFor(seg, within);
  const rate = rateOf(seg);
  const t = clip.inS + interpolate(frame, [HOLD_IN, HOLD_IN + play], [0, (play / FPS) * rate], clamp);
  const p = seg.cursor === false ? null : pointerAt(clip.events, t);
  const cursorScale = k / CURSOR_PX_PER_PT;
  const video = (
    <OffthreadVideo
      src={staticFile(clip.file)}
      startFrom={Math.round(clip.inS * FPS)}
      endAt={Math.round(clip.outS * FPS) + 2}
      muted
      playbackRate={rate}
      style={{ position: "absolute", left: -cx * k, top: -cy * k, width: (clip.w / clip.scale) * k, height: (clip.h / clip.scale) * k, maxWidth: "none" }}
    />
  );
  return (
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
      {(clip.overlays ?? []).map((o) => (
        <OverlayWindow key={o.file} overlay={o} clip={clip} cam={[cx, cy]} k={k} play={play} rate={rate} />
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
      <Keycap events={clip.events} t={t} width={w} height={h} />
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
  return (
    <>
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
        The same clicks on {BEFORE_VERSION} and on the new nightlies.
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
