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

interface Clip {
  file?: string;
  still?: string;
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
  zoom?: { cam: number[]; from: number; to: number };
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
const VERSION = "0.2.45-nightly.1";
const RELEASE = "0.2.45-nightly.1";
const BEFORE_VERSION = "0.2.44";
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

function boxFor(seg: Segment) {
  const [, , cw, ch] = seg.cam as [number, number, number, number];
  const max = seg.layout === "stack" ? STACK_BOX : SIDE_BOX;
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

function Panel({ clip, seg, play, place, after }: { clip: Clip; seg: Segment; play: number; place: Place; after: boolean }) {
  const t = useClipTime(clip, seg, play);
  return (
    <>
      <Keycap events={clip.events} t={t} right={place.left + place.w} top={place.top - 10} />
      <SideLabel after={after} version={seg.afterVersion} style={{ position: "absolute", left: place.left, top: place.top - 46 }} />
      <div style={panelStyle(place)}>
        <Footage clip={clip} seg={seg} play={play} />
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
        {speedOf(seg)}Change {number(index)}
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
          {speedOf(seg)}Change {number(index)}
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
