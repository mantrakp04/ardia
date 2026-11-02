import { loadLibrary } from "./lib.mjs";
import { ORIGINALS } from "./originals.mjs";

export function sourceBody(src, x) {
  if (src.startsWith("orig:")) {
    const original = ORIGINALS[src.slice(5)];
    return { body: original.make(x), viewBox: 32, paint: original.paint };
  }
  const icon = loadLibrary().get(src);
  return { body: icon.body, viewBox: icon.vb[2], paint: icon.kind };
}

const r4 = (n) => Math.round(n * 10000) / 10000;

export function layersFor(entry) {
  return entry.layers.map((layer, i) => {
    const source = sourceBody(layer.src, entry.perWeight.regular.params[i].x);
    const fits = {};
    for (const [weight, fitted] of Object.entries(entry.perWeight)) {
      const p = fitted.params[i];
      fits[weight] = [r4(p.s), r4(p.a), r4(p.dx), r4(p.dy), r4(p.sw), Math.round(p.rot * 10) / 10, p.flip];
    }
    return { ...source, ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}), ...(layer.knockout ? { knockout: layer.knockout } : {}), fits };
  });
}
