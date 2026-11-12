import { isFields, isPrivateProfile, ok, served, type Handlers } from "./calling";

const PNG_DATA = "data:image/png;base64,";
const FAVICON_PIXELS = 64;
const RETRY_AFTER_MS = [0, 400, 1500];
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 24;
const WIDTH_AT = 16;
const HEIGHT_AT = 20;

function headerBytes(base64: string): number[] | null {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of base64.slice(0, (HEADER_BYTES / 3) * 4)) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) return null;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return bytes.length === HEADER_BYTES ? bytes : null;
}

const bigEndian = (bytes: number[], at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;

export function pngImage(base64: string): { uri: string; width: number; height: number } | null {
  const bytes = headerBytes(base64);
  if (!bytes || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  const width = bigEndian(bytes, WIDTH_AT);
  const height = bigEndian(bytes, HEIGHT_AT);
  return width && height ? { uri: PNG_DATA + base64, width, height } : null;
}

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const faviconCalls: Handlers = {
  fetch: async (args, engine) => {
    const url = args.text("url");
    if (url.startsWith(PNG_DATA)) return ok(pngImage(url.slice(PNG_DATA.length)));
    if (!/^https?:\/\//i.test(url) || isPrivateProfile(args.profile)) return ok(null);
    for (const wait of RETRY_AFTER_MS) {
      if (wait) await later(wait);
      const { icons } = await served(engine, "ac_favicons_get", args.profile, { pages: [], icons: [url], size: FAVICON_PIXELS });
      const stored = isFields(icons) ? icons[url] : undefined;
      const image = isFields(stored) && typeof stored.png === "string" ? pngImage(stored.png) : null;
      if (image) return ok(image);
    }
    return ok(null);
  },
};
