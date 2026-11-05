import { PNG } from "pngjs";
import { symbolMarkup } from "../../src/shims/web/symbols/render.ts";
import { blur, inkDiff, rasterAlpha, readGray } from "./lib.mjs";
import { layersFor } from "./layers.mjs";
import { nativePath, renderNative } from "./native.mjs";
import { NUDGE_SIZES, NUDGE_WEIGHTS } from "./nudge.mjs";
import { SCRATCH } from "./paths.mjs";

function nudgeFor(nudges, name, weight, pt) {
  const row = nudges[name]?.[NUDGE_WEIGHTS.includes(weight) ? weight : "regular"];
  const index = NUDGE_SIZES.indexOf(pt);
  return row && index >= 0 ? [row[index][0] / 8, row[index][1] / 8] : [0, 0];
}

function dataUrl(width, pixel) {
  const png = new PNG({ width, height: width });
  for (let i = 0; i < width * width; i++) {
    const [r, g, b] = pixel(i);
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

export async function contactSheet(fits, nudges, { pt = 13, weight = "regular" } = {}) {
  const names = Object.keys(fits).sort();
  const box = Math.ceil(pt * 2), px = box * 2, key = `${pt}-${weight}`;
  renderNative(names.map((name) => ({ name, weight, pt, box, file: `val/${key}/${name}.png` })), `sheet-${key}`);
  const rows = names.map((name) => {
    const svg = symbolMarkup(layersFor(fits[name]), { pointSize: pt, weight, width: box, height: box, color: "#000", id: "c", nudge: nudgeFor(nudges, name, weight, pt) });
    const web = rasterAlpha(svg.replace(`width="${box}" height="${box}"`, `width="${px}" height="${px}"`)).a;
    const native = readGray(nativePath(`val/${key}/${name}.png`));
    const exact = inkDiff(web, native.a);
    const soft = inkDiff(blur({ w: px, h: px, a: web }, 1).a, blur(native, 1).a);
    return { name, web, native: native.a, exact, soft, sources: fits[name].layers.map((l) => l.src.replace("orig:", "◇")).join("+") };
  }).sort((a, b) => b.soft - a.soft);
  const size = Math.max(66, px);
  const cells = rows.map((r) => `<div class=c><div class=r><img src="${dataUrl(px, (i) => [255 - r.native[i], 255 - r.native[i], 255 - r.native[i]])}"><img src="${dataUrl(px, (i) => [255 - r.web[i], 255 - r.web[i], 255 - r.web[i]])}"><img src="${dataUrl(px, (i) => [255 - r.web[i], 255 - r.native[i], 255 - r.native[i]])}"></div><b>${r.name}</b><span>${r.exact.toFixed(2)} exact · ${r.soft.toFixed(2)} soft</span><i>${r.sources}</i></div>`).join("");
  const html = `<style>body{margin:0;padding:12px;background:#fff;font:10px -apple-system;width:1576px}h1{font-size:15px;margin:0 0 4px}p{margin:0 0 10px;color:#555}.g{display:flex;flex-wrap:wrap}.c{width:${Math.max(224, size * 3 + 20)}px;height:${size + 50}px;display:flex;flex-direction:column;align-items:center;border-top:1px solid #eee}.r{display:flex;gap:3px;padding-top:4px}img{width:${size}px;height:${size}px;image-rendering:pixelated}b{font-size:10px}span{color:#444}i{color:#888;font-size:8.5px;max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}</style><h1>Demo symbols vs native SF Symbols, ${pt}pt ${weight}, 2x, ${names.length} symbols, worst first</h1><p>Native render (comparison only, never shipped) · web render · overlay (red native only, cyan web only). exact = ink diff over union; soft = after a 1px blur. ◇ = original geometry.</p><div class=g>${cells}</div>`;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  await page.setContent(html);
  const out = `${SCRATCH}/contact-sheet-${key}.png`;
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  return { out, worst: rows.slice(0, 12).map((r) => `${r.name} ${r.soft.toFixed(2)}`) };
}
