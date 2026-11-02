import { symbolMarkup } from "../../src/shims/web/symbols/render.ts";
import { rasterAlpha, readGray } from "./lib.mjs";
import { layersFor } from "./layers.mjs";
import { nativePath, renderNative } from "./native.mjs";

export const NUDGE_SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30];
export const NUDGE_WEIGHTS = ["regular", "medium", "semibold", "bold"];
const BOX = 64;
const LIMIT = 12;
const EIGHTHS = 8;

function centroid(a, w) {
  let s = 0, sx = 0, sy = 0;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const v = a[y * w + x]; s += v; sx += v * x; sy += v * y; }
  return s ? [sx / s, sy / s] : [w / 2, w / 2];
}

export function computeNudges(fits, names) {
  renderNative(names.flatMap((name) => NUDGE_WEIGHTS.flatMap((weight) => NUDGE_SIZES.map((pt) => ({ name, weight, pt, box: BOX, file: `nudge/${weight}/${pt}/${name}.png` })))), "nudge");
  const quantize = (px) => Math.max(-LIMIT, Math.min(LIMIT, Math.round((px / 2) * EIGHTHS)));
  const out = {};
  for (const name of names) {
    const layers = layersFor(fits[name]);
    out[name] = {};
    for (const weight of NUDGE_WEIGHTS) {
      out[name][weight] = NUDGE_SIZES.map((pt) => {
        const native = readGray(nativePath(`nudge/${weight}/${pt}/${name}.png`));
        const svg = symbolMarkup(layers, { pointSize: pt, weight, width: BOX, height: BOX, color: "#000", id: "n" });
        const web = rasterAlpha(svg.replace(`width="${BOX}" height="${BOX}"`, `width="${BOX * 2}" height="${BOX * 2}"`));
        const [nx, ny] = centroid(native.a, BOX * 2), [wx, wy] = centroid(web.a, BOX * 2);
        return [quantize(nx - wx), quantize(ny - wy)];
      });
    }
  }
  return out;
}
