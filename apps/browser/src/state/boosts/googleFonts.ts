import { create } from "zustand";
import { readDocument, writeDocument } from "../../platform/documents";
import { base64Url } from "../../lib/sha256";
import { BOOST_FONTS, type Boost } from "./types";

export type FontFace = { weight: string; data: string };
type Status = "downloading" | "ready" | "failed";

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/;
const CSS_URL = "https://fonts.googleapis.com/css2?family=";
const FONT_ORIGIN = "https://fonts.gstatic.com/";
const LATIN_FACE = /\/\* latin \*\/\s*@font-face\s*\{([^}]*)\}/g;
const FACE_URL = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9._~/-]+\.woff2)\)\s*format\('woff2'\)/;
const FACE_WEIGHT = /font-weight:\s*(\d{3});/;
const SAVED_WEIGHT = /^\d{3}( \d{3})?$/;
const SAVED_DATA = /^[A-Za-z0-9+/]+$/;
const WOFF2 = [0x77, 0x4f, 0x46, 0x32];
const SAFARI_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const TIMEOUT_MS = 15_000;
const MAX_CSS_CHARS = 256 * 1024;
const MAX_FONT_BYTES = 400 * 1024;
const MAX_FACES = 2;

export const isGoogleFamily = (font: string) => FAMILY.test(font) && !(BOOST_FONTS as readonly string[]).includes(font);

export const useGoogleFonts = create<{ status: Record<string, Status> }>()(() => ({ status: {} }));

const setStatus = (family: string, status: Status) => useGoogleFonts.setState((s) => ({ status: { ...s.status, [family]: status } }));

const fontDocument = (family: string) => `google-font-${family.toLowerCase().replace(/ /g, "-")}.json`;

const cached = new Map<string, FontFace[]>();

function readSaved(family: string): FontFace[] {
  try {
    const faces = (JSON.parse(readDocument(fontDocument(family)) ?? "null") as { faces?: unknown } | null)?.faces;
    if (!Array.isArray(faces)) return [];
    return faces.filter((face): face is FontFace => typeof face?.weight === "string" && SAVED_WEIGHT.test(face.weight) && typeof face.data === "string" && SAVED_DATA.test(face.data));
  } catch {
    return [];
  }
}

export function googleFontFaces(font: string | null): FontFace[] {
  if (!font || !isGoogleFamily(font)) return [];
  let faces = cached.get(font);
  if (!faces) {
    faces = readSaved(font);
    cached.set(font, faces);
  }
  return faces;
}

async function get(url: string, origin: string, read: (response: Response) => Promise<string | ArrayBuffer>) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", headers: { "User-Agent": SAFARI_AGENT }, signal: abort.signal });
    if (!response.ok || (response.url && !response.url.startsWith(origin))) throw new Error(`Google Fonts answered ${response.status}`);
    return await read(response);
  } finally {
    clearTimeout(timer);
  }
}

function latinFaces(css: string) {
  const weightsByUrl = new Map<string, number[]>();
  for (const [, body] of css.matchAll(LATIN_FACE)) {
    const url = body!.match(FACE_URL)?.[1];
    const weight = body!.match(FACE_WEIGHT)?.[1];
    if (!url || !weight || !/font-style:\s*normal;/.test(body!)) continue;
    weightsByUrl.set(url, [...(weightsByUrl.get(url) ?? []), Number(weight)]);
  }
  return [...weightsByUrl].slice(0, MAX_FACES).map(([url, weights]) => {
    const low = Math.min(...weights);
    const high = Math.max(...weights);
    return { url, weight: low === high ? String(low) : `${low} ${high}` };
  });
}

async function downloadFace(url: string): Promise<string> {
  const buffer = (await get(url, FONT_ORIGIN, (response) => response.arrayBuffer())) as ArrayBuffer;
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_FONT_BYTES || !WOFF2.every((byte, i) => bytes[i] === byte)) throw new Error("not a WOFF2 font");
  return base64Url(bytes).replace(/-/g, "+").replace(/_/g, "/");
}

export async function downloadGoogleFont(family: string) {
  if (!isGoogleFamily(family) || googleFontFaces(family).length || useGoogleFonts.getState().status[family] === "downloading") return;
  setStatus(family, "downloading");
  try {
    const css = (await get(`${CSS_URL}${family.replace(/ /g, "+")}:wght@400;700`, CSS_URL, (response) => response.text())) as string;
    if (css.length > MAX_CSS_CHARS) throw new Error("font list too large");
    const sources = latinFaces(css);
    if (!sources.length) throw new Error("no Latin font");
    const faces = await Promise.all(sources.map(async ({ url, weight }) => ({ weight, data: await downloadFace(url) })));
    writeDocument(fontDocument(family), JSON.stringify({ faces }));
    cached.set(family, faces);
    setStatus(family, "ready");
  } catch (error) {
    console.warn(`[boosts] couldn't download a Google font`, error);
    setStatus(family, "failed");
  }
}

export function ensureGoogleFonts(boosts: Boost[]) {
  const { status } = useGoogleFonts.getState();
  for (const { font } of boosts) {
    if (font && isGoogleFamily(font) && !status[font] && !googleFontFaces(font).length) void downloadGoogleFont(font);
  }
}
