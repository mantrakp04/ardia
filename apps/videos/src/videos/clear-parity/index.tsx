import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";

loadFonts();

interface Pointer {
  t: number;
  x: number;
  y: number;
  down?: boolean;
}

type Cam = [x: number, y: number, w: number];

const FPS = 60;
const TITLE = Math.round(2.4 * FPS);
const SIDE = Math.round(6.6 * FPS);
const MEDIA = Math.round(6.8 * FPS);
const SOURCE = { w: 1360, h: 860 };
const CURSOR_PX_PER_PT = 2.72;
const CURSOR_TIP = { x: 18, y: 16 };
const CURSOR_HEIGHT = 44;
const PANEL = 760;
const PANEL_TOP = 190;
const PANEL_GAP = 80;
const PANEL_LEFT = (1920 - PANEL * 2 - PANEL_GAP) / 2;
const RIGHT_LEFT = PANEL_LEFT + PANEL + PANEL_GAP;
const INSET_TOP = 700;
const INSET_H = 190;

const SIDEBAR_CAM: Cam = [2.5, 50, 216];
const TOAST_CAM: Cam = [640, 772, (PANEL * 80) / INSET_H];
const CLEAR_BUTTON = { x: 160, y: 104 };
const UNDO_BUTTON = { x: 834, y: 808 };

const DIA_CLEAR_S = 2.767;
const ARDIA_CLEAR_S = 5.45;
const sidePointer: Pointer[] = [
  { t: 0, x: 205, y: 60 },
  { t: 1.3, x: 205, y: 60 },
  { t: 2.1, x: CLEAR_BUTTON.x, y: CLEAR_BUTTON.y },
  { t: 2.68, x: CLEAR_BUTTON.x, y: CLEAR_BUTTON.y, down: true },
  { t: 2.79, x: CLEAR_BUTTON.x, y: CLEAR_BUTTON.y },
];

const MEDIA_IN_S = 3.4;
const MEDIA_CLEAR_S = 4.867 - MEDIA_IN_S;
const MEDIA_UNDO_S = 8.283 - MEDIA_IN_S;
const TOAST_SHOWN_S = MEDIA_CLEAR_S + 0.15;
const mediaPointer: Pointer[] = [
  { t: 0, x: 205, y: 60 },
  { t: 0.3, x: 205, y: 60 },
  { t: 1.0, x: CLEAR_BUTTON.x, y: CLEAR_BUTTON.y },
  { t: MEDIA_CLEAR_S - 0.08, x: CLEAR_BUTTON.x, y: CLEAR_BUTTON.y, down: true },
  { t: MEDIA_CLEAR_S + 0.04, x: CLEAR_BUTTON.x, y: CLEAR_BUTTON.y },
];
const undoPointer: Pointer[] = [
  { t: 0, x: 900, y: 845 },
  { t: MEDIA_UNDO_S - 1.1, x: 900, y: 845 },
  { t: MEDIA_UNDO_S - 0.3, x: UNDO_BUTTON.x, y: UNDO_BUTTON.y },
  { t: MEDIA_UNDO_S - 0.08, x: UNDO_BUTTON.x, y: UNDO_BUTTON.y, down: true },
  { t: MEDIA_UNDO_S + 0.04, x: UNDO_BUTTON.x, y: UNDO_BUTTON.y },
];

export const meta = { width: 1920, height: 1080, fps: FPS, durationInFrames: TITLE + SIDE + MEDIA };

const label: CSSProperties = {
  fontFamily: font.mono,
  fontWeight: 460,
  fontStretch: "87.5%",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontSize: 20,
  color: color.ink2,
};

const poster: CSSProperties = {
  fontFamily: font.poster,
  fontWeight: 850,
  fontStretch: "75%",
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: color.ink,
};

const card: CSSProperties = {
  position: "absolute",
  overflow: "hidden",
  borderRadius: 22,
  background: color.night,
  boxShadow: "0 30px 70px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
};

function pointerAt(track: Pointer[], t: number) {
  const next = track.findIndex((p) => p.t > t);
  if (next === 0) return { ...track[0], pressed: false };
  const from = track[next === -1 ? track.length - 1 : next - 1];
  if (next === -1) return { ...from, pressed: !!from.down };
  const to = track[next];
  const k = interpolate(t, [from.t, to.t], [0, 1], { easing: Easing.inOut(Easing.cubic) });
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, pressed: !!from.down };
}

function rise(frame: number, delay: number): CSSProperties {
  return {
    opacity: interpolate(frame, [delay, delay + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(frame, [delay, delay + 18], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px)`,
  };
}

function Cursor({ track, t, cam, k, opacity = 1 }: { track: Pointer[]; t: number; cam: Cam; k: number; opacity?: number }) {
  const p = pointerAt(track, t);
  const s = CURSOR_HEIGHT / 160;
  return (
    <Img
      src={staticFile("brand/cursor-arrow.png")}
      style={{
        position: "absolute",
        left: (p.x - cam[0]) * k - CURSOR_TIP.x * s,
        top: (p.y - cam[1]) * k - CURSOR_TIP.y * s,
        width: 112 * s,
        height: 160 * s,
        opacity,
        transform: `scale(${p.pressed ? 0.86 : 1})`,
        transformOrigin: `${CURSOR_TIP.x / 1.12}% ${CURSOR_TIP.y / 1.6}%`,
      }}
    />
  );
}

function Footage({ src, from, cam, k }: { src: string; from: number; cam: Cam; k: number }) {
  return (
    <OffthreadVideo
      muted
      src={staticFile(src)}
      startFrom={Math.round(from * FPS)}
      style={{ position: "absolute", left: -cam[0] * k, top: -cam[1] * k, width: SOURCE.w * k, height: SOURCE.h * k }}
    />
  );
}

function Panel({ left, title, note, delay, children }: { left: number; title: string; note?: string; delay: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <>
      <div style={{ position: "absolute", left, top: PANEL_TOP - 52, ...label, color: color.ink, ...rise(frame, delay) }}>{title}</div>
      <div style={{ ...card, left, top: PANEL_TOP, width: PANEL, height: PANEL, ...rise(frame, delay) }}>{children}</div>
      {note ? (
        <div style={{ position: "absolute", left, top: PANEL_TOP + PANEL + 26, width: PANEL, fontFamily: font.serif, fontSize: 30, lineHeight: 1.3, color: color.ink, ...rise(frame, delay + 6) }}>
          {note}
        </div>
      ) : null}
    </>
  );
}

function SideBySide() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const k = PANEL / SIDEBAR_CAM[2];
  return (
    <AbsoluteFill>
      <Panel left={PANEL_LEFT} title="Dia · the issue’s recording" note="Close All keeps the selected tab. The other two close." delay={0}>
        <Img src={staticFile("footage/clear/dia-last.png")} style={{ position: "absolute", inset: 0, width: PANEL, height: PANEL }} />
        <OffthreadVideo muted src={staticFile("footage/clear/dia.mp4")} style={{ position: "absolute", inset: 0, width: PANEL, height: PANEL }} />
      </Panel>
      <Panel left={RIGHT_LEFT} title="Ardia · with this fix" note="↓ Clear keeps the selected tab. The other two close." delay={4}>
        <Footage src="footage/clear/ardia-clear.mp4" from={ARDIA_CLEAR_S - DIA_CLEAR_S} cam={SIDEBAR_CAM} k={k} />
        <Cursor track={sidePointer} t={t} cam={SIDEBAR_CAM} k={k} />
      </Panel>
    </AbsoluteFill>
  );
}

function MediaAndUndo() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const k = PANEL / SIDEBAR_CAM[2];
  const insetK = PANEL / TOAST_CAM[2];
  const toastIn = Math.round(TOAST_SHOWN_S * FPS);
  const sidebarCursor = interpolate(t, [MEDIA_CLEAR_S + 0.5, MEDIA_CLEAR_S + 0.8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Panel left={PANEL_LEFT} title="Ardia · a tab playing media" delay={0}>
        <Footage src="footage/clear/ardia-media-undo.mp4" from={MEDIA_IN_S} cam={SIDEBAR_CAM} k={k} />
        <Cursor track={mediaPointer} t={t} cam={SIDEBAR_CAM} k={k} opacity={sidebarCursor} />
      </Panel>
      <div style={{ position: "absolute", left: RIGHT_LEFT, top: PANEL_TOP, width: PANEL }}>
        <div style={{ ...label, color: color.blue, ...rise(frame, 4) }}>As in Arc</div>
        <div style={{ ...poster, marginTop: 22, fontSize: 84, lineHeight: 0.96, ...rise(frame, 8) }}>Playing tabs stay</div>
        <div style={{ marginTop: 26, height: 3, width: 64, background: color.stamp, ...rise(frame, 10) }} />
        <div style={{ marginTop: 26, fontFamily: font.serif, fontSize: 32, lineHeight: 1.32, color: color.ink, ...rise(frame, 14) }}>
          Clear skips the selected tab and a tab playing media. Undo puts the cleared tab back where it was, without loading it.
        </div>
      </div>
      <div style={{ position: "absolute", left: RIGHT_LEFT, top: INSET_TOP - 52, ...label, color: color.ink, ...rise(frame, toastIn) }}>The toast</div>
      <div style={{ ...card, left: RIGHT_LEFT, top: INSET_TOP, width: PANEL, height: INSET_H, ...rise(frame, toastIn) }}>
        <Footage src="footage/clear/ardia-media-undo.mp4" from={MEDIA_IN_S} cam={TOAST_CAM} k={insetK} />
        <Cursor track={undoPointer} t={t} cam={TOAST_CAM} k={insetK} />
      </div>
    </AbsoluteFill>
  );
}

function Title() {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [TITLE - 10, TITLE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(frame, 2) }}>Issue #149 · Clear (⇧⌘K)</div>
      <div style={{ ...poster, marginTop: 20, fontWeight: 860, fontSize: 168, lineHeight: 0.92, ...rise(frame, 6) }}>
        Clear keeps
        <br />
        the selected tab
      </div>
      <div style={{ marginTop: 26, fontFamily: font.serif, fontSize: 44, color: color.stamp, ...rise(frame, 12) }}>Dia and Ardia, side by side</div>
    </AbsoluteFill>
  );
}

function Header() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [TITLE - 6, TITLE + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: PANEL_LEFT, top: 52, right: PANEL_LEFT, display: "flex", justifyContent: "space-between", opacity }}>
      <div style={{ ...label, color: color.ink }}>Ardia · Clear unselected tabs</div>
      <div style={label}>Ardia captured in a hidden test instance</div>
    </div>
  );
}

export default function Video() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={TITLE}>
        <Title />
      </Sequence>
      <Header />
      <Sequence from={TITLE} durationInFrames={SIDE}>
        <SideBySide />
      </Sequence>
      <Sequence from={TITLE + SIDE} durationInFrames={MEDIA}>
        <MediaAndUndo />
      </Sequence>
    </AbsoluteFill>
  );
}
