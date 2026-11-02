import { boostableDomain, importableCss, safeSelector } from "./valid";
import { BOOST_CASES, BOOST_FONTS, BOOST_SIZES, type Boost, type BoostColors } from "./types";

export const SHARE_VERSION = 1;
export const SHARE_PREFIX = `ardia-boost:${SHARE_VERSION}:`;
export const SHARE_LINK_BASE = "https://ardia.dev/boost#";
export const MAX_SHARE_CODE_LENGTH = 150_000;
export const MAX_SHARE_JSON_BYTES = 200_000;
export const MAX_SHARE_NAME = 100;
export const MAX_SHARE_CSS = 50_000;
export const MAX_SHARE_ZAPS = 100;
export const MAX_SHARE_SELECTOR = 500;

export type ShareError = { error: string };

const MIN_MATCH = 4;
const MAX_MATCH = MIN_MATCH + 127;
const MAX_LITERALS = 128;
const MAX_OFFSET = 0xffff;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function compress(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const seen = new Map<number, number>();
  const keyAt = (i: number) => input[i]! | (input[i + 1]! << 8) | (input[i + 2]! << 16) | (input[i + 3]! << 24);
  let literalStart = 0;
  const flushLiterals = (end: number) => {
    while (literalStart < end) {
      const run = Math.min(MAX_LITERALS, end - literalStart);
      out.push(run - 1);
      for (let k = 0; k < run; k++) out.push(input[literalStart + k]!);
      literalStart += run;
    }
  };
  let i = 0;
  while (i < input.length) {
    let length = 0;
    let offset = 0;
    if (i + MIN_MATCH <= input.length) {
      const earlier = seen.get(keyAt(i));
      if (earlier !== undefined && i - earlier <= MAX_OFFSET) {
        while (length < MAX_MATCH && i + length < input.length && input[earlier + length] === input[i + length]) length++;
        offset = i - earlier;
      }
    }
    const step = length >= MIN_MATCH ? length : 1;
    if (step > 1) {
      flushLiterals(i);
      out.push(0x80 | (length - MIN_MATCH), offset >> 8, offset & 0xff);
      literalStart = i + length;
    }
    for (let k = i; k < i + step && k + MIN_MATCH <= input.length; k++) seen.set(keyAt(k), k);
    i += step;
  }
  flushLiterals(input.length);
  return Uint8Array.from(out);
}

function decompress(input: Uint8Array): Uint8Array | null {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const token = input[i++]!;
    if (token < 0x80) {
      const run = token + 1;
      if (i + run > input.length || out.length + run > MAX_SHARE_JSON_BYTES) return null;
      for (let k = 0; k < run; k++) out.push(input[i + k]!);
      i += run;
    } else {
      const length = (token & 0x7f) + MIN_MATCH;
      if (i + 2 > input.length || out.length + length > MAX_SHARE_JSON_BYTES) return null;
      const offset = (input[i]! << 8) | input[i + 1]!;
      i += 2;
      if (offset < 1 || offset > out.length) return null;
      for (let k = 0; k < length; k++) out.push(out[out.length - offset]!);
    }
  }
  return Uint8Array.from(out);
}

function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, bytes.length - i + 1);
    for (let k = 0; k < chars; k++) text += ALPHABET[(chunk >> (18 - 6 * k)) & 63];
  }
  return text;
}

function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(text)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    let chunk = 0;
    const chars = Math.min(4, text.length - i);
    for (let k = 0; k < 4; k++) chunk = (chunk << 6) | (k < chars ? ALPHABET.indexOf(text[i + k]!) : 0);
    for (let k = 0; k < chars - 1; k++) bytes.push((chunk >> (16 - 8 * k)) & 0xff);
  }
  return Uint8Array.from(bytes);
}

export function encodeBoost(boost: Boost): string | null {
  if (boost.js.trim()) return null;
  const shared = {
    name: boost.name,
    author: boost.author,
    domain: boost.domain,
    subdomains: boost.subdomains,
    colors: boost.colors,
    font: boost.font,
    size: boost.size,
    textCase: boost.textCase,
    zaps: boost.zaps,
    css: boost.css,
  };
  const code = SHARE_PREFIX + toBase64Url(compress(new TextEncoder().encode(JSON.stringify(shared))));
  return "error" in decodeBoost(code) ? null : code;
}

export function shareLink(code: string): string {
  return SHARE_LINK_BASE + code;
}

export function boostCodeFromLink(url: string): string | null {
  if (!url.startsWith(SHARE_LINK_BASE)) return null;
  return url.slice(SHARE_LINK_BASE.length);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
};
const inRange = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const shortText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !CONTROL.test(value);

function readColors(value: unknown): BoostColors | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["hue", "saturation", "offset", "invert", "originalSaturation", "contrast", "brightness", "appearance"])) return undefined;
  const { hue, saturation, offset, invert, originalSaturation, contrast, brightness, appearance } = value;
  if (!inRange(hue, 0, 360) || !inRange(saturation, 0, 1) || !inRange(offset, -360, 360)) return undefined;
  if (typeof invert !== "boolean" || !inRange(originalSaturation, 0, 1) || !inRange(contrast, 0, 1) || !inRange(brightness, -1, 1)) return undefined;
  if (appearance !== null && appearance !== "light" && appearance !== "dark") return undefined;
  return { hue, saturation, offset, invert, originalSaturation, contrast, brightness, appearance };
}

export function decodeBoost(code: string): Boost | ShareError {
  const input = code.trim().replace(/\s+/g, "");
  if (input.length > MAX_SHARE_CODE_LENGTH) return { error: "That code is too long to be a Boost." };
  const text = boostCodeFromLink(input) ?? input;
  if (!text) return { error: "Paste a Boost code first." };
  const version = /^ardia-boost:(\d{1,3}):/.exec(text);
  if (!version) return { error: "That doesn't look like a Boost code. It starts with ardia-boost:" };
  if (Number(version[1]) > SHARE_VERSION) return { error: "That Boost is from a newer Ardia. Update Ardia, then paste it again." };
  if (version[0] !== SHARE_PREFIX) return { error: "That doesn't look like a Boost code. It starts with ardia-boost:" };
  const damaged = { error: "That Boost code looks cut off or mistyped. Copy it again." };
  const packed = fromBase64Url(text.slice(SHARE_PREFIX.length));
  const bytes = packed && decompress(packed);
  if (!bytes) return damaged;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return damaged;
  }
  const invalid = (what: string): ShareError => ({ error: `That Boost has ${what} Ardia can't use.` });
  if (!isRecord(data)) return damaged;
  if ("js" in data) return { error: "Boosts with JavaScript can't be imported." };
  if (!hasExactKeys(data, ["name", "author", "domain", "subdomains", "colors", "font", "size", "textCase", "zaps", "css"])) return damaged;
  const { name, author, domain, subdomains, colors, font, size, textCase, zaps, css } = data;
  if (!shortText(name, MAX_SHARE_NAME)) return invalid("a name");
  if (!shortText(author, MAX_SHARE_NAME)) return invalid("an author name");
  if (typeof domain !== "string" || !DOMAIN.test(domain) || !boostableDomain(domain)) return invalid("a site");
  if (typeof subdomains !== "boolean") return invalid("a subdomains setting");
  const readColorsResult = readColors(colors);
  if (readColorsResult === undefined) return invalid("colours");
  if (font !== null && !(typeof font === "string" && (BOOST_FONTS as readonly string[]).includes(font))) return invalid("a font");
  if (!(BOOST_SIZES as readonly unknown[]).includes(size)) return invalid("a size");
  if (!(BOOST_CASES as readonly unknown[]).includes(textCase)) return invalid("a text case");
  if (!Array.isArray(zaps) || zaps.length > MAX_SHARE_ZAPS || !zaps.every((zap) => typeof zap === "string" && zap.length > 0 && zap.length <= MAX_SHARE_SELECTOR && !CONTROL.test(zap) && safeSelector(zap))) return invalid("hidden elements");
  if (typeof css !== "string" || css.length > MAX_SHARE_CSS) return invalid("CSS");
  if (!importableCss(css)) return { error: "That Boost loads files from the web (@import or url()), which Ardia doesn't import." };
  return {
    id: "",
    name,
    author,
    domain,
    subdomains,
    enabled: true,
    colors: readColorsResult,
    font,
    size: size as Boost["size"],
    textCase: textCase as Boost["textCase"],
    zaps,
    css,
    js: "",
    modified: 0,
  };
}
