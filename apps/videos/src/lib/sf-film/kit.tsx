import { createContext, type CSSProperties, type ReactNode, useContext } from "react";
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import footage from "./footage.json";
import { type Aspect, BEAT, LIGHT_BG, type Shot, type TypeLayer, type View, WIN_PT } from "./plan";
import { color } from "../ac-launch/theme";

const ShotContext = createContext<Shot | null>(null);
export const ShotProvider = ShotContext.Provider;
export function useShot(): Shot {
  const shot = useContext(ShotContext);
  if (!shot) throw new Error("useShot outside a shot");
  return shot;
}
export function useBeat(): number {
  return useCurrentFrame() / BEAT;
}
export function useAspect(): Aspect {
  const { width, height } = useVideoConfig();
  return width > height ? "land" : "port";
}

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.55, 0, 0.9, 0.4);
export const sine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function seg(b: number, start: number, dur: number, ease: (t: number) => number = easeOut) {
  if (dur <= 0) return b >= start ? 1 : 0;
  return ease(clamp((b - start) / dur));
}
export function springAt(b: number, start: number, { stiffness = 260, damping = 17, mass = 1 } = {}) {
  const t = ((b - start) * BEAT) / 30;
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}
export function kick(b: number, start: number, decay = 0.35) {
  if (b < start) return 0;
  return Math.exp(-(b - start) / decay) * Math.cos((b - start) * 9);
}

export function Paper({ tone = LIGHT_BG, children }: { tone?: string; children?: ReactNode }) {
  return <AbsoluteFill style={{ backgroundColor: tone }}>{children}</AbsoluteFill>;
}

export function Grain({ opacity = 0.08 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 12;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "multiply", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`sf-grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} />
          <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 1.4 -0.35" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#sf-grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
}

export interface Frame {
  label: string;
  t: number;
  ptr?: [number, number];
  press?: number;
  step?: number;
  seen?: number;
  up?: number;
  typed?: string;
  has?: number;
  head?: { x: number; y: number; width: number; height: number };
  rows?: Record<string, { x: number; y: number; width: number; height: number } | null>;
}
interface SceneData {
  size: [number, number];
  frames: Frame[];
  menu?: { id?: string; title?: string; symbol?: string; separator?: boolean; enabled?: boolean; items?: unknown[] }[];
  sharesheet?: string;
  [key: string]: unknown;
}
export const SCENES = footage as unknown as Record<string, SceneData>;
export function scene(name: string): SceneData {
  const s = SCENES[name];
  if (!s) throw new Error(`no footage for ${name} (run scripts/capture/sf-run.sh, then sf-composite.py)`);
  return s;
}
export function indexOf(name: string, label: string, from = 0) {
  const i = scene(name).frames.findIndex((f, k) => k >= from && f.label === label);
  if (i < 0) throw new Error(`${name}: no frame labelled ${label}`);
  return i;
}
export function lastIndexOf(name: string, label: string) {
  const fr = scene(name).frames;
  for (let i = fr.length - 1; i >= 0; i--) if (fr[i].label === label) return i;
  throw new Error(`${name}: no frame labelled ${label}`);
}
export function byTime(name: string, labels: string[], t0: number, slow: number, ms: number) {
  const fr = scene(name).frames;
  let pick = -1;
  for (let i = 0; i < fr.length; i++) {
    if (!labels.includes(fr[i].label)) continue;
    if (pick < 0 || (fr[i].t - t0) / slow <= ms) pick = i;
    if ((fr[i].t - t0) / slow > ms) break;
  }
  if (pick < 0) throw new Error(`${name}: no frames ${labels.join(",")}`);
  return pick;
}
export function footageSrc(name: string, index: number) {
  const n = scene(name).frames.length;
  const i = Math.max(0, Math.min(n - 1, Math.round(index)));
  return staticFile(`footage/${name}/${String(i).padStart(4, "0")}.jpg`);
}

export type Cam = View;
export type CamKey = Partial<View> & { at: number; ease?: "spring" | "out" | "inout" | "cut"; dur?: number };
export function camAt(keys: CamKey[], b: number): View {
  let pose: View = { cx: 640, cy: 400, s: 1, ...keys[0] };
  for (let k = 1; k < keys.length; k++) {
    const key = keys[k];
    if (b < key.at) break;
    const target: View = { ...pose, ...key };
    const e = key.ease ?? "spring";
    const t = e === "cut" ? 1 : e === "spring" ? springAt(b, key.at, { stiffness: 170, damping: 22 }) : seg(b, key.at, key.dur ?? 1, e === "out" ? easeOut : easeInOut);
    pose = { cx: mix(pose.cx, target.cx, t), cy: mix(pose.cy, target.cy, t), s: mix(pose.s, target.s, t) };
  }
  return pose;
}

const CORNER_PT = 21;

export function Screen({
  id, src, index, view, children, overlay, tag, tagColor, backdrop = color.paperDeep, radius = 30, shadow = 1,
}: {
  id: string;
  src: string;
  index: number;
  view: View;
  children?: ReactNode;
  overlay?: ReactNode;
  tag?: string;
  tagColor?: string;
  backdrop?: string;
  radius?: number;
  shadow?: number;
}) {
  const object = useStudioObject(id);
  const w = object.number("width");
  const h = object.number("height");
  const geometry = object.geometry({ x: "x", y: "y", width: "width", height: "height", rotation: "rotation" });
  const s = view.s;
  const hw = w / 2 / s;
  const hh = h / 2 / s;
  const cx = hw * 2 >= WIN_PT[0] ? WIN_PT[0] / 2 : clamp(view.cx, hw, WIN_PT[0] - hw);
  const cy = hh * 2 >= WIN_PT[1] ? WIN_PT[1] / 2 : clamp(view.cy, hh, WIN_PT[1] - hh);
  const left = w / 2 - cx * s;
  const top = h / 2 - cy * s;
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style }}>
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden", backgroundColor: backdrop,
          boxShadow: shadow ? `0 ${0.01 * w}px ${0.03 * w}px rgba(22,19,15,${0.22 * shadow}), 0 ${0.04 * w}px ${0.09 * w}px rgba(22,19,15,${0.26 * shadow})` : undefined,
        }}
      >
        <div style={{ position: "absolute", left, top, width: WIN_PT[0] * s, height: WIN_PT[1] * s, borderRadius: CORNER_PT * s, overflow: "hidden", boxShadow: `0 ${6 * s}px ${24 * s}px rgba(22,19,15,0.22)` }}>
          <Img src={footageSrc(src, index)} style={{ width: "100%", height: "100%", display: "block" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: CORNER_PT * s, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)" }} />
        </div>
        <div style={{ position: "absolute", left, top, width: WIN_PT[0], height: WIN_PT[1], transform: `scale(${s})`, transformOrigin: "0 0" }}>{children}</div>
        {overlay}
        <div style={{ position: "absolute", inset: 0, borderRadius: radius, boxShadow: "inset 0 0 0 1.5px rgba(22,19,15,0.10)", pointerEvents: "none" }} />
      </div>
      {tag ? <NameTag text={tag} fill={tagColor ?? color.ink} scale={Math.min(1, Math.max(0.62, w / 900))} /> : null}
    </div>
  );
}

export function NameTag({ text, fill, scale = 1 }: { text: string; fill: string; scale?: number }) {
  return (
    <div
      style={{
        transform: `scale(${scale})`, transformOrigin: "0 100%",
        position: "absolute", left: 14, top: -60, height: 50, padding: "0 22px", borderRadius: 26, backgroundColor: fill,
        display: "flex", alignItems: "center", gap: 12, boxShadow: "0 6px 18px rgba(22,19,15,0.25)",
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.92)", color: fill, fontFamily: '-apple-system, "SF Pro Text", sans-serif', fontWeight: 700, fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {text[0]}
      </div>
      <span style={{ fontFamily: '-apple-system, "SF Pro Text", sans-serif', fontWeight: 600, fontSize: 26, color: "#FFFFFF" }}>{text}</span>
    </div>
  );
}

const POINTERS = { arrow: { pt: [28, 40], hot: [5, 5] }, hand: { pt: [32, 32], hot: [12, 8] } } as const;
export function Pointer({ x, y, kind = "arrow", press = 0 }: { x: number; y: number; kind?: "arrow" | "hand"; press?: number }) {
  const p = POINTERS[kind];
  const sz = 1 - 0.12 * press;
  return (
    <Img
      src={staticFile(`brand/cursor-${kind}.png`)}
      style={{
        position: "absolute", left: x - p.hot[0], top: y - p.hot[1], width: p.pt[0], height: p.pt[1],
        scale: String(sz), transformOrigin: `${p.hot[0]}px ${p.hot[1]}px`, filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.3))",
      }}
    />
  );
}

export function pointerPath(b: number, stops: { at: number; x: number; y: number; click?: boolean }[], travel = 0.5) {
  if (b < stops[0].at - travel) return null;
  let i = 0;
  while (i + 1 < stops.length && b >= stops[i + 1].at - travel) i++;
  const cur = stops[i];
  const next = stops[i + 1];
  let x = cur.x;
  let y = cur.y;
  if (next && b >= next.at - travel) {
    const t = sine(clamp((b - (next.at - travel)) / travel));
    x = mix(cur.x, next.x, t);
    y = mix(cur.y, next.y, t);
  } else if (i === 0 && b < cur.at) {
    const t = easeOut(clamp((b - (cur.at - travel)) / travel));
    x = mix(cur.x + 60, cur.x, t);
    y = mix(cur.y + 90, cur.y, t);
  }
  const clicked = [cur, next].find((s) => s && s.click && b >= s.at && b < s.at + 0.3);
  const press = clicked ? Math.sin(clamp((b - clicked.at) / 0.3) * Math.PI) : 0;
  return { x, y, press };
}

const SANS = '-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif';
const STYLE: Record<TypeLayer["style"], CSSProperties> = {
  caption: { fontFamily: SANS, fontWeight: 600, letterSpacing: "-0.018em", lineHeight: 1.12 },
  title: { fontFamily: SANS, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.02 },
  label: { fontFamily: SANS, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.1 },
};

export function Type({ layer }: { layer: TypeLayer }) {
  const shot = useShot();
  const b = useBeat();
  const frame = useVideoConfig();
  const object = useStudioObject(layer.id);
  const out = layer.out ?? shot.beats;
  if (b < layer.at || b >= out) return null;
  const inT = layer.at <= 0 || layer.cut ? 1 : easeOut(clamp((b - layer.at) / 0.55));
  const outT = out >= shot.beats || layer.cut ? 1 : clamp((out - b) / 0.4);
  const opacity = Math.min(inT, outT);
  const rise = (1 - inT) * 14;
  const text = object.text("text");
  const ink = object.text("color");
  const size = object.number("size");
  const align = (frame.width < frame.height && layer.portAlign) || layer.align || "center";
  const geometry = object.geometry({ x: "x", y: "y", width: "width", height: "height", rotation: "rotation" }, { offset: { y: rise } });
  return (
    <div
      {...object.bind}
      {...geometry.bind}
      style={{ ...geometry.style, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center", opacity }}
    >
      <p {...object.bindText("text")} style={{ ...STYLE[layer.style], margin: 0, whiteSpace: "pre-line", fontSize: size, color: ink, textAlign: align }}>
        {text}
      </p>
    </div>
  );
}

export function Supers() {
  const shot = useShot();
  return (
    <>
      {shot.type.map((layer) => (
        <Type key={layer.id} layer={layer} />
      ))}
    </>
  );
}
