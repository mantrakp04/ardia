import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
export function packageDir(name) {
  const dir = (require.resolve.paths(name) ?? []).map((root) => `${root}/${name}`).find((candidate) => existsSync(`${candidate}/package.json`));
  if (!dir) throw new Error(`${name} is not installed; run pnpm install`);
  return dir;
}
export const packageMeta = (name) => JSON.parse(readFileSync(`${packageDir(name)}/package.json`, "utf8"));

export const ICON_SETS = [
  { set: "lucide", pkg: "lucide-static", dir: "icons", kind: "stroke", title: "Lucide", url: "https://lucide.dev" },
  { set: "tabler", pkg: "@tabler/icons", dir: "icons/outline", kind: "stroke", title: "Tabler Icons", url: "https://tabler.io/icons" },
  { set: "tabler-filled", pkg: "@tabler/icons", dir: "icons/filled", kind: "fill", title: "Tabler Icons", url: "https://tabler.io/icons" },
  { set: "iconoir", pkg: "iconoir", dir: "icons/regular", kind: "stroke", title: "Iconoir", url: "https://iconoir.com" },
  { set: "iconoir-solid", pkg: "iconoir", dir: "icons/solid", kind: "fill", title: "Iconoir", url: "https://iconoir.com" },
  { set: "phosphor", pkg: "@phosphor-icons/core", dir: "assets/regular", kind: "fill", title: "Phosphor Icons", url: "https://phosphoricons.com" },
  { set: "phosphor-fill", pkg: "@phosphor-icons/core", dir: "assets/fill", kind: "fill", title: "Phosphor Icons", url: "https://phosphoricons.com" },
  { set: "mdi", pkg: "@mdi/svg", dir: "svg", kind: "fill", title: "Material Design Icons (Pictogrammers)", url: "https://pictogrammers.com/library/mdi" },
];

function inner(svg) {
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  return svg.slice(open + 1, svg.lastIndexOf("</svg>"))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/g, "")
    .replace(/\s(stroke|fill)="currentColor"/g, "")
    .replace(/\s(stroke-width|stroke-linecap|stroke-linejoin|class)="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function viewBoxOf(svg) {
  const head = svg.slice(svg.indexOf("<svg"), svg.indexOf(">", svg.indexOf("<svg")));
  const match = head.match(/\sviewBox="([^"]*)"/);
  return (match ? match[1] : "0 0 24 24").split(/[\s,]+/).map(Number);
}

let library;
export function loadLibrary() {
  if (library) return library;
  library = new Map();
  for (const { set, pkg, dir, kind } of ICON_SETS) {
    const root = `${packageDir(pkg)}/${dir}`;
    for (const file of readdirSync(root)) {
      if (!file.endsWith(".svg")) continue;
      const svg = readFileSync(`${root}/${file}`, "utf8");
      const name = file.slice(0, -4);
      library.set(`${set}:${name}`, { id: `${set}:${name}`, set, name, kind, vb: viewBoxOf(svg), body: inner(svg) });
    }
  }
  return library;
}

export function rasterAlpha(svg) {
  const r = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  const px = r.pixels;
  const a = new Uint8Array(r.width * r.height);
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
  return { w: r.width, h: r.height, a };
}

export function readGray(path) {
  const png = PNG.sync.read(readFileSync(path));
  const a = new Uint8Array(png.width * png.height);
  for (let i = 0; i < a.length; i++) a[i] = png.data[i * 4];
  return { w: png.width, h: png.height, a };
}

export function inkDiff(x, y) {
  let diff = 0, union = 0;
  for (let i = 0; i < x.length; i++) {
    const p = x[i], q = y[i];
    diff += p > q ? p - q : q - p;
    union += p > q ? p : q;
  }
  return union ? diff / union : 0;
}

export function blur(img, r) {
  const { w, h, a } = img;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) acc += a[y * w + Math.min(w - 1, x + r)] ?? 0;
      if (x - r - 1 >= 0) acc -= a[y * w + x - r - 1];
      if (x >= 0 && x < w) tmp[y * w + x] = acc / (2 * r + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) acc += tmp[Math.min(h - 1, y + r) * w + x];
      if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * w + x];
      if (y >= 0 && y < h) out[y * w + x] = acc / (2 * r + 1);
    }
  }
  return { w, h, a: out };
}

export function bbox(img, threshold = 24) {
  const { w, h, a } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > threshold) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
