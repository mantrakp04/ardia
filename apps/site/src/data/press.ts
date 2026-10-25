import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { DISCORD, MIN_MACOS, REPO } from "./release";

const repoRoot = `${process.cwd()}/../..`;
const siteRoot = process.cwd();

export const SITE = "ardia.dev";
export const FIRST_RELEASE = "25 September 2026";
export const MAKER = "Mantra Patel";

export const SHORT =
  "Ardia is a free, open-source Mac browser with Arc’s sidebar and Dia’s polish, built on Chromium.";
export const LONG = `Ardia is a web browser for the Mac with Arc’s sidebar and Dia’s polish, built on Chromium and Chrome’s own framework, so sites, extensions and DevTools behave as they do in Chrome. The full uBlock Origin is built in, so ads, trackers and cookie banners stay out, and Google’s background services are compiled out. Profiles keep work and home apart, and Sync runs end to end encrypted through the user’s own iCloud Drive. Ardia is free and open source under the GPL-3.0, notarized by Apple, and runs on Apple Silicon Macs with ${MIN_MACOS} or later. The first public build shipped on ${FIRST_RELEASE}.`;

export const FACTS: { term: string; value: string; href?: string }[] = [
  { term: "Name", value: "Ardia" },
  { term: "What", value: "A web browser for the Mac" },
  { term: "Engine", value: "Chromium, on Chrome’s own framework" },
  { term: "Runs on", value: `Apple Silicon, ${MIN_MACOS} or later` },
  { term: "Price", value: "Free" },
  { term: "Licence", value: "GPL-3.0 (Ardia’s own code: Apache-2.0)" },
  { term: "First release", value: FIRST_RELEASE },
  { term: "Made by", value: MAKER },
  { term: "Website", value: SITE, href: `https://${SITE}` },
  { term: "Source", value: REPO.replace("https://", ""), href: REPO },
  { term: "Community", value: "Discord", href: DISCORD },
];

export const COLOURS: { name: string; hex: string; use: string }[] = [
  { name: "Sun", hex: "#E6BC62", use: "The logo’s sun." },
  { name: "Sage", hex: "#71955A", use: "The hill at the back." },
  { name: "Forest", hex: "#203F32", use: "The hill in front." },
  { name: "Parchment", hex: "#F9F5E3", use: "The app icon’s tile." },
  { name: "Paper", hex: "#F1ECE2", use: "The site’s background." },
  { name: "Ink", hex: "#16130F", use: "Text on the site." },
];

export const FONTS = [
  {
    name: "Mona Sans",
    by: "GitHub",
    use: "Headlines, squeezed and heavy, and body text.",
    href: "https://github.com/github/mona-sans",
    family: "var(--poster)",
  },
  {
    name: "Martian Mono",
    by: "Evil Martians",
    use: "Labels and small print, in capitals.",
    href: "https://github.com/evilmartians/mono",
    family: "var(--mono)",
  },
];

type Format = "svg" | "png";
export interface Logo {
  id: string;
  title: string;
  use: string;
  ground: "light" | "night";
  formats: Format[];
}

export const LOGOS: Logo[] = [
  { id: "app-icon", title: "App icon", use: "The one to use. The painted tile, as it sits in the Dock.", ground: "light", formats: ["png"] },
  { id: "mark-painted", title: "Painted mark", use: "The hills without the tile, for when the logo stands on its own.", ground: "light", formats: ["png"] },
  { id: "mark-colour", title: "Flat mark", use: "Three flat colours, for small sizes and print.", ground: "light", formats: ["svg", "png"] },
  { id: "mark-black", title: "One colour, black", use: "On light backgrounds.", ground: "light", formats: ["svg", "png"] },
  { id: "mark-white", title: "One colour, white", use: "On dark backgrounds and photos.", ground: "night", formats: ["svg", "png"] },
];

export const SHOTS: { id: string; title: string }[] = [
  { id: "window", title: "The window" },
  { id: "split", title: "Split view" },
  { id: "tab-group", title: "Tab groups" },
  { id: "pip", title: "The mini player" },
  { id: "address-sidebar", title: "Address bar in the sidebar" },
  { id: "little-ardia", title: "Little Ardia" },
  { id: "extensions", title: "Chrome Web Store" },
  { id: "privacy", title: "Privacy settings" },
];

const glyphSubpaths = (() => {
  const source = readFileSync(`${repoRoot}/engine/patches/build/ardia-icons/chrome/app/vector_icons/browser_logo.icon`, "utf8");
  const letters: Record<string, string> = { MOVE_TO: "M", LINE_TO: "L", CUBIC_TO: "C", CLOSE: "Z" };
  const paths: string[] = [];
  for (const line of (source as string).split("\n")) {
    const [command, ...numbers] = line.split(",").map((s) => s.trim()).filter(Boolean);
    const letter = command && letters[command];
    if (!letter) continue;
    if (letter === "M") paths.push("");
    paths[paths.length - 1] += letter + numbers.join(" ");
  }
  return paths;
})();

const GLYPH_BOX = "0.9 2.9 14.2 10.2";
const markSvg = (fills: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GLYPH_BOX}" width="1420" height="1020">${glyphSubpaths
    .map((d, i) => `<path fill="${fills[i] ?? fills[0]}" d="${d}"/>`)
    .join("")}</svg>\n`;

const hex = (name: string) => COLOURS.find((c) => c.name === name)!.hex;
export const MARK_SVGS: Record<string, string> = {
  "mark-colour": markSvg([hex("Forest"), hex("Sage"), hex("Sun")]),
  "mark-black": markSvg([hex("Ink")]),
  "mark-white": markSvg(["#FFFFFF"]),
};

const svgToPng = (svg: string) => sharp(Buffer.from(svg), { density: 144 }).resize({ width: 2048 }).png({ compressionLevel: 9 }).toBuffer();

const builders: Record<string, () => Promise<Buffer> | Buffer> = {
  "ardia-app-icon.png": () =>
    readFileSync(`${repoRoot}/apps/browser/macos/Ardia-macOS/Assets.xcassets/AppIcon.appiconset/icon_512x512_2x.png`),
  "ardia-mark-painted.png": () =>
    sharp(`${repoRoot}/docs/brand/ardia/source/mark.png`).trim({ threshold: 16 }).png({ compressionLevel: 9 }).toBuffer(),
  ...Object.fromEntries(
    Object.entries(MARK_SVGS).flatMap(([id, svg]) => [
      [`ardia-${id}.svg`, () => Buffer.from(svg)],
      [`ardia-${id}.png`, () => svgToPng(svg)],
    ]),
  ),
  ...Object.fromEntries(
    SHOTS.map(({ id }) => [
      `ardia-screenshot-${id}.png`,
      () => sharp(`${siteRoot}/src/assets/shots/${id}.webp`).png({ compressionLevel: 9 }).toBuffer(),
    ]),
  ),
};

export const logoFile = (id: string, format: Format) => `ardia-${id}.${format}`;
export const shotFile = (id: string) => `ardia-screenshot-${id}.png`;
export const PRESS_FILES = Object.keys(builders);
export const ZIP_NAME = "ardia-press-kit.zip";

const built = new Map<string, Promise<Buffer>>();
export const pressFile = (name: string) => {
  if (!built.has(name)) built.set(name, Promise.resolve(builders[name]!()));
  return built.get(name)!;
};

const readme = () =>
  [
    "Ardia press kit",
    "",
    SHORT,
    "",
    LONG,
    "",
    ...FACTS.map((f) => `${f.term}: ${f.href ?? f.value}`),
    "",
    "Colours",
    ...COLOURS.map((c) => `${c.name} ${c.hex}: ${c.use}`),
    "",
    "Use the logos as they are: no redrawing, recolouring, stretching or effects.",
    "Ardia isn’t affiliated with Google or The Browser Company. Arc, Dia and Chrome are their trademarks.",
    `More at https://${SITE}/press`,
    "",
  ].join("\n");

const zipEntryPath = (name: string) =>
  name.startsWith("ardia-screenshot-") ? `screenshots/${name}` : `logo/${name}`;

function zip(entries: { path: string; data: Buffer }[]) {
  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { path, data } of entries) {
    const name = Buffer.from(`ardia-press-kit/${path}`, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

let kit: Promise<Buffer> | undefined;
export const pressZip = () =>
  (kit ??= Promise.all(PRESS_FILES.map(async (name) => ({ path: zipEntryPath(name), data: await pressFile(name) }))).then(
    (files) => zip([{ path: "README.txt", data: Buffer.from(readme(), "utf8") }, ...files]),
  ));

export const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export function oklch(hexColour: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hexColour.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 0.0005 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}
