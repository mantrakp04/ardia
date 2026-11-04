import { Img } from "remotion";
import { clamp, footageSrc, mix } from "./kit";
import { SIDEBAR_PT, WIN_PT } from "./plan";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Rows = Record<string, Rect | null | undefined>;

const PAD = 1.5;
const FAR = 60;
const BAND = SIDEBAR_PT + 2;

function Slice({ src, index, left, top, height, dy = 0, opacity = 1, lift = 0 }: { src: string; index: number; left: number; top: number; height: number; dy?: number; opacity?: number; lift?: number }) {
  if (height <= 0.2) return null;
  return (
    <div
      style={{
        position: "absolute", left, top: top + dy, width: BAND, height, overflow: "hidden", opacity,
        boxShadow: lift ? `0 ${3 * lift}px ${12 * lift}px rgba(0,0,0,${0.22 * lift})` : undefined, borderRadius: lift ? 8 : 0,
        scale: lift ? String(1 + 0.015 * lift) : undefined,
      }}
    >
      <Img src={footageSrc(src, index)} style={{ position: "absolute", left: -left, top: -top, width: WIN_PT[0], height: WIN_PT[1] }} />
    </div>
  );
}

const listed = (rows: Rows, left: number) =>
  Object.entries(rows)
    .filter((e): e is [string, Rect] => !!e[1] && e[1].height > 0 && e[1].x >= left - 1 && e[1].x < left + BAND)
    .sort((a, b) => a[1].y - b[1].y);

export interface Plan {
  left: number;
  top: number;
  target: Rect | null;
  from: Rect | null;
  bands: { top: number; height: number; delta: number; gone: boolean; far: boolean }[];
  blocks: { top: number; height: number }[];
}

export function sidebarLeft(rows: Rows) {
  const xs = Object.values(rows).filter((r): r is Rect => !!r).map((r) => r.x);
  return xs.length && Math.min(...xs) > WIN_PT[0] / 2 ? WIN_PT[0] - BAND : 0;
}

export function planMorph(rowsB: Rows, rowsA: Rows): Plan | null {
  const left = sidebarLeft({ ...rowsB, ...rowsA });
  const b = listed(rowsB, left);
  const a = listed(rowsA, left);
  if (!a.length) return null;
  const inB = new Map(b);
  const inA = new Map(a);
  const delta = (id: string) => (inA.has(id) && inB.has(id) ? inA.get(id)!.y - inB.get(id)!.y : 0);
  const changed = b.filter(([id]) => !inA.has(id) || Math.abs(delta(id)) > 0.5).map(([, r]) => r.y);
  const fresh = a.filter(([id]) => !inB.has(id));
  changed.push(...fresh.map(([, r]) => r.y));
  if (!changed.length) return null;
  const top = Math.min(...changed) - PAD;
  const bands: Plan["bands"] = [];
  b.forEach(([id, r], i) => {
    const d = delta(id);
    bands.push({ top: r.y - PAD, height: r.height + 2 * PAD, delta: d, gone: !inA.has(id), far: Math.abs(d) > FAR });
    const end = r.y + r.height + PAD;
    const next = b[i + 1];
    const fillerEnd = next ? next[1].y - PAD : WIN_PT[1];
    const owner = next ? next[0] : id;
    if (fillerEnd > end) bands.push({ top: end, height: fillerEnd - end, delta: delta(owner), gone: false, far: false });
  });
  const blocks: Plan["blocks"] = [];
  let i = 0;
  while (i < a.length) {
    if (inB.has(a[i][0])) {
      i++;
      continue;
    }
    const start = a[i][1].y - PAD;
    let j = i;
    while (j + 1 < a.length && !inB.has(a[j + 1][0])) j++;
    const next = a[j + 1];
    const stop = next ? next[1].y - PAD : a[j][1].y + a[j][1].height + PAD;
    blocks.push({ top: start, height: stop - start });
    i = j + 1;
  }
  const movedFar = b.find(([id]) => Math.abs(delta(id)) > FAR);
  const target = fresh[0]?.[1] ?? (movedFar ? inA.get(movedFar[0])! : null);
  const from = !fresh.length && movedFar ? movedFar[1] : null;
  return { left, top, target, from, bands, blocks };
}

export function Morph({ src, before, after, plan, p, tint }: { src: string; before: number; after: number; plan: Plan; p: number; tint: [string, string] }) {
  const t = clamp(p);
  const near = plan.bands.filter((band) => !band.far);
  const far = plan.bands.filter((band) => band.far);
  const lift = Math.sin(Math.PI * t);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: WIN_PT[0], height: WIN_PT[1], overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute", left: plan.left, top: plan.top, width: BAND, height: WIN_PT[1] - plan.top,
          backgroundImage: `linear-gradient(to bottom, ${tint[0]}, ${tint[1]})`, backgroundSize: `${BAND}px ${WIN_PT[1]}px`,
          backgroundPosition: `0 ${-plan.top}px`,
        }}
      />
      {near.filter((band) => band.top + band.height > plan.top).map((band, k) => (
        <Slice key={`n${k}`} src={src} index={before} left={plan.left} top={band.top} height={band.height} dy={band.delta * t} opacity={band.gone ? 1 - t : 1} />
      ))}
      {plan.blocks.map((block, k) => (
        <div key={`b${k}`} style={{ position: "absolute", left: plan.left, top: block.top, width: BAND, height: block.height * t, overflow: "hidden", opacity: clamp(t * 1.6) }}>
          <Img src={footageSrc(src, after)} style={{ position: "absolute", left: -plan.left, top: -block.top - (1 - t) * 6, width: WIN_PT[0], height: WIN_PT[1] }} />
        </div>
      ))}
      {far.map((band, k) => (
        <Slice key={`f${k}`} src={src} index={before} left={plan.left} top={band.top} height={band.height} dy={band.delta * t} lift={lift} />
      ))}
    </div>
  );
}

export function targetAt(plan: Plan, t: number): Rect | null {
  if (!plan.target) return null;
  if (plan.from) return { ...plan.target, y: mix(plan.from.y, plan.target.y, t) };
  return { ...plan.target, height: plan.target.height * clamp(t) };
}
