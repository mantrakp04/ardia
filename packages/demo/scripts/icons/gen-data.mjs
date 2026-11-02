import { readFileSync, writeFileSync } from "node:fs";
import { layersFor } from "./layers.mjs";
import { ICON_SETS, packageDir, packageMeta } from "./lib.mjs";
import { NUDGE_SIZES, NUDGE_WEIGHTS } from "./nudge.mjs";
import { SYMBOLS_DIR } from "./paths.mjs";

const WEIGHTS = ["light", "regular", "medium", "semibold", "bold"];
const TITLE = Object.fromEntries(ICON_SETS.map((s) => [s.set, s.title]));

export function writeData(fits, nudges) {
  const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
  const nudgeRows = [];
  const bodies = [];
  const bodyIndex = new Map();
  const used = {};
  const entries = [];
  for (const name of Object.keys(fits).sort()) {
    const entry = fits[name];
    const layers = layersFor(entry);
    const encoded = layers.map((layer, i) => {
      const src = entry.layers[i].src;
      const set = src.split(":")[0];
      if (set !== "orig") (used[TITLE[set]] ??= new Set()).add(src.split(":")[1]);
      const body = layer.body.replace(/\s+/g, " ").replace(/> </g, "><").trim();
      if (!bodyIndex.has(body)) { bodyIndex.set(body, bodies.length); bodies.push(body); }
      const fitRows = WEIGHTS.map((w) => layer.fits[w].map((n) => +n.toFixed(4)));
      return [bodyIndex.get(body), layer.viewBox, layer.paint === "stroke" ? 0 : 1, layer.opacity ?? 1, layer.knockout ?? 0, fitRows];
    });
    entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(encoded)},`);
    nudgeRows.push(`  ${JSON.stringify(name)}: "${NUDGE_WEIGHTS.map((w) => nudges[name][w].map(([x, y]) => DIGITS[x + 12] + DIGITS[y + 12]).join("")).join("")}",`);
  }

  const header = `/*! Ardia demo symbol artwork. Drawn from open icon sets, not SF Symbols: Lucide (ISC), Tabler Icons (MIT), Iconoir (MIT), Phosphor Icons (MIT), Material Design Icons by Pictogrammers (Apache-2.0), plus original geometry. Notices: THIRD_PARTY_NOTICES.txt */`;
  const ts = `${header}
import type { SymbolLayer, SymbolWeight } from "./render";

type EncodedLayer = readonly [body: number, viewBox: number, filled: 0 | 1, opacity: number, knockout: number, fits: readonly (readonly number[])[]];

const BODIES: readonly string[] = ${JSON.stringify(bodies, null, 0).replace(/","/g, '",\n  "').replace(/^\["/, '[\n  "').replace(/"\]$/, '",\n]')};

const ENCODED: Record<string, readonly EncodedLayer[]> = {
${entries.join("\n")}
};

const WEIGHTS: readonly SymbolWeight[] = ${JSON.stringify(WEIGHTS)};

function decode(layers: readonly EncodedLayer[]): SymbolLayer[] {
  return layers.map(([body, viewBox, filled, opacity, knockout, rows]) => {
    const fits = Object.fromEntries(WEIGHTS.map((weight, i) => [weight, rows[i] as unknown as SymbolLayer["fits"]["regular"]])) as SymbolLayer["fits"];
    return { body: BODIES[body] ?? "", viewBox, paint: filled ? "fill" : "stroke", ...(opacity < 1 ? { opacity } : {}), ...(knockout ? { knockout } : {}), fits };
  });
}

const cache = new Map<string, SymbolLayer[]>();

export function symbolLayers(name: string): SymbolLayer[] | null {
  const hit = cache.get(name);
  if (hit) return hit;
  const encoded = ENCODED[name];
  if (!encoded) return null;
  const layers = decode(encoded);
  cache.set(name, layers);
  return layers;
}

export const SYMBOL_NAMES: readonly string[] = Object.keys(ENCODED);

const NUDGE_SIZES: readonly number[] = ${JSON.stringify(NUDGE_SIZES)};
const NUDGE_WEIGHTS: readonly SymbolWeight[] = ${JSON.stringify(NUDGE_WEIGHTS)};
const NUDGE_DIGITS = "${DIGITS}";
const NUDGE_STEP = 8;
const NUDGE_ZERO = 12;

const NUDGES: Record<string, string> = {
${nudgeRows.join("\n")}
};

export function symbolNudge(name: string, weight: SymbolWeight, pointSize: number): readonly [number, number] {
  const row = NUDGES[name];
  const sizeIndex = NUDGE_SIZES.indexOf(pointSize);
  if (!row || sizeIndex < 0) return [0, 0];
  const weightIndex = Math.max(0, NUDGE_WEIGHTS.indexOf(weight));
  const at = (weightIndex * NUDGE_SIZES.length + sizeIndex) * 2;
  const decode = (offset: number) => (NUDGE_DIGITS.indexOf(row[at + offset] ?? "c") - NUDGE_ZERO) / NUDGE_STEP;
  return [decode(0), decode(1)];
}
`;
  writeFileSync(`${SYMBOLS_DIR}data.ts`, ts);
  writeNotices(used);
  return { bodies: bodies.length, bytes: ts.length };
}

function writeNotices(used) {
  const seen = new Set();
  let out = "Third-party notices for the Ardia demo symbol artwork (packages/demo/src/shims/web/symbols/data.ts)\n\nThe demo draws its icons from the open icon sets below, rescaled and repositioned, and from original geometry drawn for Ardia. It contains no SF Symbols artwork.\n";
  for (const { pkg, title, url } of ICON_SETS) {
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const meta = packageMeta(pkg);
    out += `\n${"=".repeat(78)}\n${title} (${pkg} ${meta.version}, ${meta.license}) ${url}\nIcons used: ${used[title] ? [...used[title]].sort().join(", ") : "none"}\n${"-".repeat(78)}\n${readFileSync(`${packageDir(pkg)}/LICENSE`, "utf8").trim()}\n`;
  }
  writeFileSync(`${SYMBOLS_DIR}THIRD_PARTY_NOTICES.txt`, out);
}
