import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { symbolMarkup } from "../../src/shims/web/symbols/render.ts";
import { nativePath, renderNative } from "./native.mjs";
import { loadLibrary, rasterAlpha, readGray, inkDiff, blur, bbox } from "./lib.mjs";
import { curatedIds } from "./curated.mjs";
import { RECIPES } from "./recipes.mjs";
import { ORIGINALS } from "./originals.mjs";

const WEIGHTS = ["light", "regular", "medium", "semibold", "bold"];
const PT = 26, BOX = 52, SCALE = 2;
const KEYS = ["s", "a", "dx", "dy", "sw", "rot"];

function sourceIcon(lib, src) {
  if (src.startsWith("orig:")) {
    const o = ORIGINALS[src.slice(5)];
    if (!o) throw new Error("missing original " + src);
    return { id: src, make: o.make, pdef: o.params, vb: [0, 0, 32, 32], kind: o.paint };
  }
  const icon = lib.get(src);
  if (!icon) throw new Error("missing icon " + src);
  return icon;
}

function toLayers(spec, params) {
  return spec.map((l, i) => {
    const p = params[i];
    return { body: l.icon.make ? l.icon.make(p.x) : l.icon.body, viewBox: l.icon.vb[2], paint: l.icon.kind, opacity: l.opacity, knockout: l.knockout, fits: { regular: [p.s, p.a, p.dx, p.dy, p.sw, p.rot, p.flip] } };
  });
}

function render(spec, params) {
  const svg = symbolMarkup(toLayers(spec, params), { pointSize: PT, weight: "regular", width: BOX, height: BOX, color: "#000", id: "f" });
  return rasterAlpha(svg.replace(`width="${BOX}" height="${BOX}"`, `width="${BOX * SCALE}" height="${BOX * SCALE}"`));
}

function score(spec, params, target, targetBlur) {
  const img = render(spec, params);
  const exact = inkDiff(img.a, target.a);
  if (targetBlur.coarse) return { exact, total: inkDiff(blur(img, targetBlur.coarse).a, targetBlur.a) };
  return { exact, total: exact + 0.5 * inkDiff(blur(img, 1).a, targetBlur.a) };
}
function coarseTarget(target, r) { const b = blur(target, r); b.coarse = r; return b; }

function clampOk(spec, params) {
  return params.every((p, i) => Object.entries(spec[i].icon.pdef ?? {}).every(([k, d]) => p.x[k] >= d.min && p.x[k] <= d.max)) && params.every((p, i) => p.s > 0.15 && p.a >= 0.85 && p.a <= 1.18 && p.sw >= (spec[i].icon.kind === "stroke" ? 0.02 : 0) && (spec[i].orient || spec[i].rotFree || p.rot === spec[i].baseRot));
}

function search(spec, params, target, targetBlur, maxIter = 80, scaleStep = 1, lockX = false) {
  let best = score(spec, params, target, targetBlur);
  const steps = params.map((_, i) => ({ s: 0.06 * scaleStep, a: 0.04 * scaleStep, dx: 0.03 * scaleStep, dy: 0.03 * scaleStep, sw: 0.012 * scaleStep, rot: spec[i].rotFree ? 4 * scaleStep : 0, ...Object.fromEntries(Object.entries(spec[i].icon.pdef ?? {}).map(([k, d]) => ["x." + k, lockX ? 0 : d.step * scaleStep])) }));
  const floors = { s: 0.002, a: 0.003, dx: 0.0015, dy: 0.0015, sw: 0.0008, rot: 0.3 };
  for (let iter = 0; iter < maxIter; iter++) {
    let improved = false;
    for (let li = 0; li < params.length; li++) {
      if (spec[li].frozen) continue;
      for (const key of [...KEYS, ...Object.keys(spec[li].icon.pdef ?? {}).map((k) => "x." + k)]) {
        if (!steps[li][key]) continue;
        if (spec[li].lock?.includes(key)) continue;
        for (const sign of [1, -1]) {
          const next = params.map((p) => ({ ...p, x: { ...p.x } }));
          if (key.startsWith("x.")) next[li].x[key.slice(2)] += sign * steps[li][key];
          else next[li][key] += sign * steps[li][key];
          if (!clampOk(spec, next)) continue;
          const r = score(spec, next, target, targetBlur);
          if (r.total < best.total - 1e-6) { params = next; best = r; improved = true; break; }
        }
      }
    }
    if (!improved) {
      let done = true;
      for (const st of steps) for (const key of Object.keys(st)) if (st[key] > (floors[key] ?? 0.02)) { st[key] /= 2; done = false; }
      if (done) break;
    }
  }
  return { params, ...best };
}

function initialParams(spec, target) {
  return spec.map((l) => {
    const base = { s: l.icon.make ? 32 / 24 : 1, a: 1, dx: 0, dy: 0, sw: l.icon.kind === "stroke" ? 0.077 : 0, rot: l.rot ?? 0, flip: l.flip ?? 1, ...(l.init ?? {}), x: { ...Object.fromEntries(Object.entries(l.icon.pdef ?? {}).map(([k, d]) => [k, d.v])), ...(l.init?.x ?? {}) } };
    if (l.init?.s !== undefined || l.icon.make) return base;
    const solo = render([l], [base]);
    const a = bbox(solo), b = bbox(target);
    if (!a || !b) return base;
    const k = Math.min((b.x1 - b.x0) / (a.x1 - a.x0), (b.y1 - b.y0) / (a.y1 - a.y0));
    const c = BOX;
    base.s *= k;
    base.dx = ((b.x0 + b.x1) / 2 - c) / SCALE / PT - (((a.x0 + a.x1) / 2 - c) / SCALE / PT) * k;
    base.dy = ((b.y0 + b.y1) / 2 - c) / SCALE / PT - (((a.y0 + a.y1) / 2 - c) / SCALE / PT) * k;
    return base;
  });
}

function fitRecipe(spec, target) {
  const targetBlur = blur(target, 1);
  let candidates = [initialParams(spec, target)];
  const orientLayer = spec.findIndex((l) => l.orient);
  if (orientLayer >= 0) {
    candidates = [];
    for (const rot of [0, 45, -45, 90, -90, 180]) for (const flip of [1, -1]) {
      const sp = spec.map((l, i) => (i === orientLayer ? { ...l, rot, flip } : l));
      candidates.push({ sp, params: initialParams(sp, target) });
    }
    const quick = candidates.map((c) => ({ ...c, r: search(c.sp.map((l) => ({ ...l, baseRot: l.rot ?? 0 })), c.params, target, targetBlur, 12, 1) }));
    quick.sort((x, y) => x.r.total - y.r.total);
    const winner = quick[0];
    spec.splice(0, spec.length, ...winner.sp);
    candidates = [winner.r.params];
  }
  const sp = spec.map((l) => ({ ...l, baseRot: l.rot ?? 0 }));
  const fine = search(sp, candidates[0], target, targetBlur);
  const coarse = search(sp, search(sp, candidates[0], target, coarseTarget(target, 4), 40).params, target, targetBlur);
  return { spec: sp, ...(coarse.exact < fine.exact ? coarse : fine) };
}

export const REFERENCE_WEIGHTS = WEIGHTS;

export async function fitSymbols(names) {
  renderNative(names.flatMap((name) => WEIGHTS.map((weight) => ({ name, weight, pt: PT, box: BOX, file: `ref/${weight}/${name}.png` }))), "reference");
  const results = {};
  let next = 0, done = 0;
  const workers = Math.max(1, Math.min(names.length, availableParallelism() - 1));
  await new Promise((resolve, reject) => {
    for (let w = 0; w < workers; w++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => { if (next < names.length) worker.postMessage(names[next++]); else worker.terminate(); };
      worker.on("message", (m) => {
        if (m.error) { reject(new Error(m.error)); return; }
        results[m.name] = m.result;
        if (++done % 25 === 0) console.log(`  fitted ${done}/${names.length}`);
        if (done === names.length) resolve();
        feed();
      });
      worker.on("error", reject);
      feed();
    }
  });
  return results;
}

if (!isMainThread) {
  const lib = loadLibrary();
  parentPort.on("message", (name) => {
    const targets = Object.fromEntries(WEIGHTS.map((w) => [w, readGray(nativePath(`ref/${w}/${name}.png`))]));
    const recipe = RECIPES[name] ?? {};
    const recipes = (recipe.recipes ?? []).map((r) => r.map((l) => ({ ...l, icon: sourceIcon(lib, l.src) })));
    const singles = recipe.exclusive ? [] : [...curatedIds(name), ...(recipe.extra ?? [])].filter((id) => lib.has(id)).map((id) => [{ src: id, icon: lib.get(id), orient: recipe.orient }]);
    if (!recipes.length && !singles.length) {
      parentPort.postMessage({ name, error: `${name}: no candidates; add it to curated.mjs or recipes.mjs` });
      return;
    }
    const tried = [...recipes, ...singles].map((spec) => ({ spec, r: fitRecipe(spec, targets.regular) }));
    tried.sort((x, y) => x.r.exact - y.r.exact);
    const win = tried[0];
    const perWeight = { regular: { params: win.r.params, exact: win.r.exact } };
    for (const w of WEIGHTS) {
      if (w === "regular") continue;
      const r = search(win.r.spec, win.r.params.map((p) => ({ ...p, x: { ...p.x } })), targets[w], blur(targets[w], 1), 60, 0.5, true);
      perWeight[w] = { params: r.params, exact: r.exact };
    }
    parentPort.postMessage({
      name,
      result: {
        layers: win.r.spec.map((l) => ({ src: l.src, opacity: l.opacity, knockout: l.knockout })),
        perWeight,
        alternatives: tried.slice(1, 6).map((t) => ({ srcs: t.spec.map((l) => l.src).join("+"), exact: +t.r.exact.toFixed(3) })),
      },
    });
  });
}
