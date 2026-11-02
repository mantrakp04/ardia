import { BOOST_CASES, BOOST_SIZES, type Boost, type BoostCase, type BoostColors, type BoostSize } from "./types";

type Fields = Record<string, unknown>;

const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

export function validColors(raw: unknown): BoostColors | null {
  if (!isFields(raw)) return null;
  const { hue, saturation, offset, invert, originalSaturation, contrast, brightness, appearance } = raw;
  if (![hue, saturation, offset, originalSaturation, contrast, brightness].every(isNumber) || !isBoolean(invert)) return null;
  if (appearance !== null && appearance !== "light" && appearance !== "dark") return null;
  return {
    hue: (((hue as number) % 360) + 360) % 360,
    saturation: clamp(saturation as number, 0, 1),
    offset: offset as number,
    invert,
    originalSaturation: clamp(originalSaturation as number, 0, 1),
    contrast: clamp(contrast as number, 0, 1),
    brightness: clamp(brightness as number, -1, 1),
    appearance,
  };
}

export function validBoost(id: string, raw: unknown): Boost | null {
  if (!isFields(raw)) return null;
  const { name, author, domain, subdomains, enabled, colors, font, size, textCase, zaps, css, js, modified } = raw;
  if (![name, author, domain, css, js].every(isString) || !isBoolean(subdomains) || !isBoolean(enabled) || !isNumber(modified)) return null;
  if (!boostableDomain(domain as string)) return null;
  if (font !== null && !isString(font)) return null;
  if (!BOOST_SIZES.includes(size as BoostSize) || !BOOST_CASES.includes(textCase as BoostCase)) return null;
  if (!Array.isArray(zaps) || !zaps.every(isString)) return null;
  const checked = colors === null ? null : validColors(colors);
  if (colors !== null && !checked) return null;
  if (id.length > MAX_ID || (domain as string).length > 253 || !withinSourceLimit({ css: css as string, js: js as string })) return null;
  return {
    id,
    name: name as string,
    author: author as string,
    domain: domain as string,
    subdomains,
    enabled,
    colors: checked,
    font: font as string | null,
    size: size as BoostSize,
    textCase: textCase as BoostCase,
    zaps,
    css: css as string,
    js: js as string,
    modified,
  };
}

export const withoutId = ({ id: _id, ...rest }: Boost) => rest;

const UNSAFE_SELECTOR = /[{};@<>]|\/\*/;
const WEB_URL = /url\(\s*(?!["']?data:)/i;
const FETCHING_CSS = /@import|image-set\(|image\(|cross-fade\(|src\(|\\/i;

export const safeSelector = (selector: string) => selector.trim().length > 0 && !UNSAFE_SELECTOR.test(selector) && !/(^|[^\\])(\\\\)*\\$/.test(selector);
export const importableCss = (css: string) => !FETCHING_CSS.test(css) && !WEB_URL.test(css);

const HOSTNAME = /^([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/;
const GENERIC_SECOND_LEVEL = /^(co|com|org|net|gov|edu|ac|or|ne|go)\.[a-z]{2}$/;
export function boostableDomain(domain: string) {
  const host = domain.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return HOSTNAME.test(host) && (host === "localhost" || (host.includes(".") && !GENERIC_SECOND_LEVEL.test(host)));
}

const MAX_ID = 128;
const MAX_SOURCE = 1024 * 1024;
export const withinSourceLimit = (code: Pick<Boost, "css" | "js">) => code.css.length <= MAX_SOURCE && code.js.length <= MAX_SOURCE;
