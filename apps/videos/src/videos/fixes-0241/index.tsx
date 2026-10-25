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
  file: string;
  inS: number;
  outS: number;
  events: Event[];
}

interface Segment {
  scene: string;
  title: string;
  body: string;
  cam: number[];
  length: number;
  masks?: number[][];
  afterOnly?: string;
  before?: Clip;
  after: Clip;
}

const FPS = 60;
const TITLE = Math.round(2.4 * FPS);
const HOLD_IN = Math.round(0.6 * FPS);
const HOLD_OUT = Math.round(1.0 * FPS);
const SOURCE = { w: 1360, h: 860 };
const PANEL = { y: 236, w: 880, h: 800 };
const LEFT = 60;
const RIGHT = 980;
const CURSOR_PX_PER_PT = 2.72;
const CURSOR_TIP = { x: 18, y: 16 };
const PICKER_SURFACE = "rgb(247, 245, 243)";
const VERSION = "0.2.41-nightly.1";
const BEFORE_VERSION = "0.2.40";

const all = segments as Segment[];
const plays = all.map((s) => Math.round(s.length * FPS));
const lengths = plays.map((p) => HOLD_IN + p + HOLD_OUT);
const starts = lengths.map((_, i) => TITLE + lengths.slice(0, i).reduce((a, b) => a + b, 0));
const total = TITLE + lengths.reduce((a, b) => a + b, 0);

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

function Keycap({ events, t }: { events: Event[]; t: number }) {
  const shown = events.filter((e) => e.mark && t >= e.t && t < e.t + 1.3);
  if (!shown.length) return null;
  const e = shown[shown.length - 1];
  const k = t - e.t;
  const opacity = interpolate(k, [0, 0.12, 1.1, 1.3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lift = interpolate(k, [0, 0.18], [14, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div
      style={{
        position: "absolute",
        left: PANEL.w / 2,
        top: PANEL.h - 120 + lift,
        transform: "translateX(-50%)",
        opacity,
        padding: "14px 26px",
        borderRadius: 16,
        background: color.ink,
        color: color.paper,
        fontFamily: font.poster,
        fontWeight: 760,
        fontSize: 46,
        lineHeight: 1,
        whiteSpace: "nowrap",
        boxShadow: "0 18px 40px rgba(22,19,15,0.28)",
      }}
    >
      {e.mark}
    </div>
  );
}

function Footage({ clip, cam, masks, play }: { clip: Clip; cam: number[]; masks?: number[][]; play: number }) {
  const frame = useCurrentFrame();
  const [cx, cy, cw] = cam;
  const k = PANEL.w / cw;
  const t = clip.inS + interpolate(frame, [HOLD_IN, HOLD_IN + play], [0, play / FPS], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const p = pointerAt(clip.events, t);
  const video = (
    <OffthreadVideo
      src={staticFile(clip.file)}
      startFrom={Math.round(clip.inS * FPS)}
      endAt={Math.round(clip.outS * FPS) + 2}
      muted
      style={{ position: "absolute", left: -cx * k, top: -cy * k, width: SOURCE.w * k, height: SOURCE.h * k }}
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
      {(masks ?? []).map(([mx, my, mw, mh]) => (
        <div
          key={`${mx},${my}`}
          style={{ position: "absolute", left: (mx - cx) * k, top: (my - cy) * k, width: mw * k, height: mh * k, background: PICKER_SURFACE }}
        />
      ))}
      {p ? (
        <Img
          src={staticFile("brand/cursor-arrow.png")}
          style={{
            position: "absolute",
            left: (p.x - cx) * k - (CURSOR_TIP.x * k) / CURSOR_PX_PER_PT,
            top: (p.y - cy) * k - (CURSOR_TIP.y * k) / CURSOR_PX_PER_PT,
            width: (112 * k) / CURSOR_PX_PER_PT,
            height: (160 * k) / CURSOR_PX_PER_PT,
            transform: `scale(${p.pressed ? 0.86 : 1})`,
            transformOrigin: `${CURSOR_TIP.x / 1.12}% ${CURSOR_TIP.y / 1.6}%`,
          }}
        />
      ) : null}
      <Keycap events={clip.events} t={t} />
    </>
  );
}

const panelBox = (left: number, opacity: number): CSSProperties => ({
  position: "absolute",
  left,
  top: PANEL.y,
  width: PANEL.w,
  height: PANEL.h,
  overflow: "hidden",
  borderRadius: 22,
  background: color.paperDeep,
  boxShadow: "0 30px 70px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
  opacity,
});

function SideLabel({ left, after, style }: { left: number; after: boolean; style: CSSProperties }) {
  return (
    <div style={{ position: "absolute", left, top: PANEL.y - 44, display: "flex", alignItems: "center", gap: 14, ...style }}>
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
      <div style={{ ...label, fontSize: 18 }}>{after ? VERSION : BEFORE_VERSION}</div>
    </div>
  );
}

function Shot({ seg, index, length, play }: { seg: Segment; index: number; length: number; play: number }) {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 9, length - 6, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const textIn = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(frame, [delay, delay + 18], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px)`,
  });
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: LEFT, top: 40, right: 60, display: "flex", justifyContent: "space-between", ...textIn(0) }}>
        <div style={{ ...label, color: color.ink }}>Ardia {VERSION} · before and after</div>
        <div style={{ ...label, color: color.blue }}>
          Fix {String(index + 1).padStart(2, "0")} / {String(all.length).padStart(2, "0")}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: 84,
          width: 880,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          fontSize: 60,
          lineHeight: 0.98,
          color: color.ink,
          ...textIn(4),
        }}
      >
        {seg.title}
      </div>
      <div style={{ position: "absolute", left: RIGHT, top: 84, width: 880, fontFamily: font.serif, fontSize: 29, lineHeight: 1.3, color: color.ink, ...textIn(8) }}>
        {seg.body}
      </div>
      <SideLabel left={LEFT} after={false} style={textIn(10)} />
      <SideLabel left={RIGHT} after style={textIn(12)} />
      {seg.before ? (
        <div style={panelBox(LEFT, fade)}>
          <Footage clip={seg.before} cam={seg.cam} masks={seg.masks} play={play} />
        </div>
      ) : (
        <div style={{ ...panelBox(LEFT, fade), display: "flex", alignItems: "center", justifyContent: "center", padding: 90, boxSizing: "border-box" }}>
          <div style={{ fontFamily: font.serif, fontSize: 34, lineHeight: 1.32, color: color.ink2, textAlign: "center" }}>{seg.afterOnly}</div>
        </div>
      )}
      <div style={panelBox(RIGHT, fade)}>
        <Footage clip={seg.after} cam={seg.cam} masks={seg.masks} play={play} />
      </div>
    </AbsoluteFill>
  );
}

function Title() {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(frame, [delay, delay + 22], [28, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [TITLE - 10, TITLE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(2) }}>Nightly · before and after</div>
      <div style={{ marginTop: 20, fontFamily: font.poster, fontWeight: 860, fontStretch: "75%", fontSize: 230, lineHeight: 0.9, color: color.ink, ...rise(6) }}>
        Ardia
      </div>
      <div style={{ marginTop: 18, fontFamily: font.poster, fontWeight: 700, fontStretch: "87.5%", fontSize: 92, color: color.stamp, ...rise(12) }}>{VERSION}</div>
      <div style={{ marginTop: 22, fontFamily: font.serif, fontSize: 36, color: color.ink2, ...rise(16) }}>
        Same clicks on {BEFORE_VERSION} and on today's build.
      </div>
      <Img src={staticFile("brand/app-icon.png")} style={{ position: "absolute", right: 170, top: 300, width: 480, height: 480, ...rise(10) }} />
    </AbsoluteFill>
  );
}

export default function Video() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={TITLE}>
        <Title />
      </Sequence>
      {all.map((seg, i) => (
        <Sequence key={seg.scene} from={starts[i]} durationInFrames={lengths[i]}>
          <Shot seg={seg} index={i} length={lengths[i]} play={plays[i]} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
