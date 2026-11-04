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

function Slice({ src, index, top, height, dy = 0, opacity = 1 }: { src: string; index: number; top: number; height: number; dy?: number; opacity?: number }) {
  if (height <= 0.2) return null;
  return (
    <div style={{ position: "absolute", left: 0, top: top + dy, width: SIDEBAR_PT, height, overflow: "hidden", opacity }}>
      <Img src={footageSrc(src, index)} style={{ position: "absolute", left: 0, top: -top, width: WIN_PT[0], height: WIN_PT[1] }} />
    </div>
  );
}

const listed = (rows: Rows) =>
  Object.entries(rows)
    .filter((e): e is [string, Rect] => !!e[1] && e[1].x < SIDEBAR_PT && e[1].height > 0)
    .sort((a, b) => a[1].y - b[1].y);

export interface Plan {
  top: number;
  target: Rect | null;
  from: Rect | null;
  bands: { top: number; height: number; delta: number; gone: boolean; far: boolean }[];
  blocks: { top: number; height: number }[];
}

export function planMorph(rowsB: Rows, rowsA: Rows): Plan | null {
  const b = listed(rowsB);
  const a = listed(rowsA);
  const inB = new Map(b);
  const inA = new Map(a);
  const delta = (id: string) => (inA.has(id) ? inA.get(id)!.y - inB.get(id)!.y : 0);
  const changed = b.filter(([id]) => !inA.has(id) || Math.abs(delta(id)) > 0.5).map(([, r]) => r.y);
  const fresh = a.filter(([id]) => !inB.has(id));
  changed.push(...fresh.map(([, r]) => r.y));
  if (!changed.length) return null;
  const top = Math.min(...changed) - PAD;
  const bands: Plan["bands"] = [];
  b.forEach(([id, r], i) => {
    const d = delta(id);
    const gone = !inA.has(id);
    const far = Math.abs(d) > FAR;
    bands.push({ top: r.y - PAD, height: r.height + 2 * PAD, delta: d, gone, far });
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
  return { top, target, from, bands, blocks };
}

export function Morph({ src, before, after, plan, p, tint }: { src: string; before: number; after: number; plan: Plan; p: number; tint: [string, string] }) {
  const t = clamp(p);
  const near = plan.bands.filter((band) => !band.far);
  const far = plan.bands.filter((band) => band.far);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: SIDEBAR_PT, height: WIN_PT[1], overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute", left: 0, top: plan.top, width: SIDEBAR_PT, height: WIN_PT[1] - plan.top,
          backgroundImage: `linear-gradient(to bottom, ${tint[0]}, ${tint[1]})`, backgroundSize: `${SIDEBAR_PT}px ${WIN_PT[1]}px`,
          backgroundPosition: `0 ${-plan.top}px`,
        }}
      />
      {near.filter((band) => band.top + band.height > plan.top).map((band, k) => (
        <Slice key={`n${k}`} src={src} index={before} top={band.top} height={band.height} dy={band.delta * t} opacity={band.gone ? 1 - t : 1} />
      ))}
      {plan.blocks.map((block, k) => (
        <div key={`b${k}`} style={{ position: "absolute", left: 0, top: block.top, width: SIDEBAR_PT, height: block.height * t, overflow: "hidden", opacity: clamp(t * 1.6) }}>
          <Img src={footageSrc(src, after)} style={{ position: "absolute", left: 0, top: -block.top - (1 - t) * 6, width: WIN_PT[0], height: WIN_PT[1] }} />
        </div>
      ))}
      {far.map((band, k) => (
        <Slice key={`f${k}`} src={src} index={before} top={band.top} height={band.height} dy={band.delta * t} />
      ))}
    </div>
  );
}

export function targetAt(plan: Plan, t: number): Rect | null {
  if (!plan.target) return null;
  if (plan.from) return { ...plan.target, y: mix(plan.from.y, plan.target.y, t) };
  return { ...plan.target, height: plan.target.height * clamp(t) };
}
