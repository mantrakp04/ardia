import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";
import segments from "./segments.json";

loadFonts();

interface Segment {
  scene: string;
  title: string;
  body: string;
  cam: number[];
}

const FPS = 60;
const INTRO = Math.round(2.6 * FPS);
const CARD = Math.round(1.4 * FPS);
const SHOT = Math.round(3.8 * FPS);
const OUTRO = Math.round(2.4 * FPS);
const AREA = { top: 250, bottom: 1040 };
const SIDE_BOX = { w: 880, h: AREA.bottom - AREA.top };
const LEFT = 60;
const RIGHT = 980;
const RELEASE = "0.2.44-nightly.1";
const BEFORE_VERSION = "0.2.43";
const FOOTAGE = "footage/0244n1";
const SOURCE_SIZE: Record<string, [number, number]> = {
  settings: [1640, 1280],
  dia: [2560, 1600],
};

const all = segments as Segment[];
const length = CARD + SHOT;
const total = INTRO + all.length * length + OUTRO;

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

const number = (i: number) => `${String(i + 1).padStart(2, "0")} / ${String(all.length).padStart(2, "0")}`;

function boxFor(seg: Segment) {
  const [, , cw, ch] = seg.cam as [number, number, number, number];
  const k = Math.min(SIDE_BOX.w / cw, SIDE_BOX.h / ch);
  return { w: Math.round(cw * k), h: Math.round(ch * k), k };
}

function sourceSize(scene: string) {
  return SOURCE_SIZE[scene.split("-")[0]!]!;
}

function Still({ seg, side }: { seg: Segment; side: "before" | "after" }) {
  const [cx, cy] = seg.cam as [number, number];
  const { k } = boxFor(seg);
  const [sw, sh] = sourceSize(seg.scene);
  return (
    <Img
      src={staticFile(`${FOOTAGE}/${side}/${seg.scene}.png`)}
      style={{ position: "absolute", left: -cx * k, top: -cy * k, width: sw * k, height: sh * k, maxWidth: "none" }}
    />
  );
}

function SideLabel({ after, style }: { after: boolean; style?: CSSProperties }) {
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
      <div style={{ ...label, fontSize: 18 }}>{after ? RELEASE : BEFORE_VERSION}</div>
    </div>
  );
}

function Panel({ seg, after }: { seg: Segment; after: boolean }) {
  const frame = useCurrentFrame();
  const { w, h } = boxFor(seg);
  const left = (after ? RIGHT : LEFT) + (SIDE_BOX.w - w) / 2;
  const top = AREA.top + Math.max(0, (SIDE_BOX.h - h) / 2);
  const rise = interpolate(frame, [after ? 10 : 0, (after ? 10 : 0) + 30], [16, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: "absolute", left, top: top + rise }}>
      <SideLabel after={after} style={{ position: "absolute", left: 0, top: -46 }} />
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          overflow: "hidden",
          borderRadius: 18,
          background: color.paperDeep,
          boxShadow: "0 30px 70px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
        }}
      >
        <Still seg={seg} side={after ? "after" : "before"} />
      </div>
    </div>
  );
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
        <div style={{ ...label, fontSize: 24, color: color.blue }}>After {RELEASE}</div>
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
      <div style={{ ...label, marginTop: 30, fontSize: 20, ...rise(12) }}>Change {number(index)}</div>
    </AbsoluteFill>
  );
}

function Shot({ seg, index }: { seg: Segment; index: number }) {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 16, SHOT - 12, SHOT], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: LEFT, top: 40, right: 60, display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...label, color: color.ink }}>Ardia {RELEASE} · before and after</div>
        <div style={{ ...label, color: color.blue }}>Change {number(index)}</div>
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
      <Panel seg={seg} after={false} />
      <Panel seg={seg} after />
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
        Every corner, gap and font size now agrees.
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
        <Sequence key={seg.scene} from={INTRO + i * length} durationInFrames={length}>
          <Sequence durationInFrames={CARD}>
            <Card seg={seg} index={i} />
          </Sequence>
          <Sequence from={CARD} durationInFrames={SHOT}>
            <Shot seg={seg} index={i} />
          </Sequence>
        </Sequence>
      ))}
      <Sequence from={total - OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
