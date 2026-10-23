import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const directory = new URL("../assets/sidebar-icons/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("sources.json", directory), "utf8"));
const sourcesPath = new URL("svg-sources.json", directory);
const entries = manifest.icons;
const atlasWidth = manifest.columns * manifest.tileSize;
const atlasHeight = manifest.rows * manifest.tileSize;
const catalogSource = await readFile(new URL("../src/lib/iconCatalog.ts", import.meta.url), "utf8");
const catalogNames = [...catalogSource.matchAll(/\{ name: "([^"]+)"/g)].map((match) => match[1]);

if (catalogNames.length !== entries.length || entries.some(({ name }, index) => name !== catalogNames[index])) {
  throw new Error("Atlas order differs from ICON_CATALOG");
}

if (new Set(entries.map(({ name }) => name)).size !== entries.length || entries.length > manifest.columns * manifest.rows) {
  throw new Error("Invalid icon catalog");
}

function verifyPin(contents, expected, label) {
  if (!/^[0-9a-f]{64}$/.test(expected ?? "")) throw new Error(`Missing SHA-256 pin for ${label}`);
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${label}: expected ${expected}, received ${actual}`);
  return actual;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

if (process.argv.includes("--fetch")) {
  const sources = { lucide: {}, duotone: {} };
  const tasks = ["lucide", "duotone"].flatMap((style) => entries.map((entry) => async () => {
    const { repository, commit } = manifest[style];
    const upstreamPath = style === "lucide" ? `icons/${entry[style]}.svg` : `assets/duotone/${entry[style]}-duotone.svg`;
    const url = `${repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${commit}/${upstreamPath}`;
    sources[style][entry[style]] = await fetchText(url);
  }));
  const failures = [];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (tasks.length) {
      const task = tasks.shift();
      try { await task(); } catch (error) { failures.push(error.message); }
    }
  }));
  if (failures.length) throw new Error(failures.join("\n"));
  const fetchedLicenses = {};
  for (const style of ["lucide", "duotone"]) {
    const { repository, commit, license, licenseSha256 } = manifest[style];
    const url = `${repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${commit}/LICENSE`;
    fetchedLicenses[style] = await fetchText(url);
    verifyPin(fetchedLicenses[style], licenseSha256, license);
    sources[style] = Object.fromEntries(entries.map((entry) => [entry[style], sources[style][entry[style]]]));
  }
  const sourceText = JSON.stringify(sources, null, 2) + "\n";
  verifyPin(sourceText, manifest.sourcesSha256, "svg-sources.json");
  for (const style of ["lucide", "duotone"]) {
    await writeFile(new URL(manifest[style].license, directory), fetchedLicenses[style]);
  }
  await writeFile(sourcesPath, sourceText);
}

const sourceText = await readFile(sourcesPath, "utf8");
const sourceHash = verifyPin(sourceText, manifest.sourcesSha256, "svg-sources.json");
const sources = JSON.parse(sourceText);
const licenses = {};
for (const style of ["lucide", "duotone"]) {
  const { license, licenseSha256 } = manifest[style];
  licenses[style] = await readFile(new URL(license, directory), "utf8");
  verifyPin(licenses[style], licenseSha256, license);
}
const render = (svg) => new Resvg(svg, { font: { loadSystemFonts: false } }).render();

function embedLicense(png, license) {
  const text = `License\0${license}`;
  const data = Buffer.from(text, "latin1");
  if (data.toString("latin1") !== text) throw new Error("PNG license text requires Latin-1 encoding");
  const typeAndData = Buffer.concat([Buffer.from("tEXt", "ascii"), data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), data.length + 8);
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IEND") {
      return Buffer.concat([png.subarray(0, offset), chunk, png.subarray(offset)]);
    }
    offset += length + 12;
  }
  throw new Error("PNG has no IEND chunk");
}

function svgBody(svg) {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
}

function duotoneLayer(svg, secondary) {
  const shapes = svgBody(svg).match(/<(?:path|rect|circle|line|polyline|polygon|ellipse)\b[^>]*\/>/g);
  if (!shapes?.length) throw new Error("Duotone source has no shapes");
  const selected = shapes.filter((shape) => {
    const opacity = shape.match(/\bopacity="([\d.]+)"/);
    return Boolean(opacity && Number(opacity[1]) < 1) === secondary;
  });
  if (!selected.length) throw new Error(`Duotone ${secondary ? "secondary" : "primary"} layer is empty`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#ffffff">${selected.map((shape) => shape.replace(/\sopacity="[^"]*"/g, "").replaceAll("currentColor", "#ffffff")).join("")}</svg>`;
}

function sizeSvg(svg, attributes) {
  return svg.replace(/<svg\b[^>]*>/, (root) => root.replace(/\s(?:width|height)="[^"]*"/g, "").replace(/<svg\b/, `<svg ${attributes}`));
}

function tile(svg, index) {
  const x = index % manifest.columns * manifest.tileSize;
  const y = Math.floor(index / manifest.columns) * manifest.tileSize;
  return sizeSvg(svg, `x="${x}" y="${y}" width="${manifest.tileSize}" height="${manifest.tileSize}"`);
}

const variants = [
  { name: "lucide", source: "lucide", layer: (svg) => svg.replaceAll("currentColor", "#ffffff") },
  { name: "duotone-fill", source: "duotone", layer: (svg) => duotoneLayer(svg, true) },
  { name: "duotone-stroke", source: "duotone", layer: (svg) => duotoneLayer(svg, false) },
];

for (const variant of variants) {
  const tiles = entries.map((entry, index) => {
    const original = sources[variant.source][entry[variant.source]];
    if (!original) throw new Error(`Missing ${variant.source} ${entry.name}`);
    const svg = variant.layer(original);
    const pixels = render(sizeSvg(svg, `width="${manifest.tileSize}" height="${manifest.tileSize}"`)).pixels;
    if (!pixels.some((alpha, offset) => offset % 4 === 3 && alpha > 0)) throw new Error(`Empty ${variant.name} ${entry.name}`);
    return tile(svg, index);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${atlasWidth}" height="${atlasHeight}" viewBox="0 0 ${atlasWidth} ${atlasHeight}">${tiles.join("")}</svg>`;
  const output = new URL(`${variant.name}.png`, directory);
  const rendered = render(svg);
  const pixels = rendered.pixels;
  for (let index = 0; index < manifest.columns * manifest.rows; index++) {
    const left = index % manifest.columns * manifest.tileSize;
    const top = Math.floor(index / manifest.columns) * manifest.tileSize;
    let visible = false;
    for (let y = top; y < top + manifest.tileSize && !visible; y++) {
      for (let x = left; x < left + manifest.tileSize; x++) {
        if (pixels[(y * atlasWidth + x) * 4 + 3]) { visible = true; break; }
      }
    }
    if (visible !== (index < entries.length)) throw new Error(`Invalid ${variant.name} atlas tile ${index}`);
  }
  const png = embedLicense(rendered.asPng(), licenses[variant.source]);
  await writeFile(output, png);
  console.log(`${fileURLToPath(output)}: ${atlasWidth}×${atlasHeight}, ${entries.length} nonempty tiles, ${png.length} bytes`);
}
console.log(`Verified pinned SVG source SHA-256: ${sourceHash}`);
