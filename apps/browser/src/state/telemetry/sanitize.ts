
const FILE_EXTENSIONS =
  "json|jsonl|js|mjs|cjs|jsx|ts|tsx|map|bundle|jsbundle|hbc|html?|css|txt|md|rtf|csv|log|ips|plist|xml|ya?ml|pdf|docx?|xlsx?|pptx?|key|pages|numbers|png|jpe?g|gif|webp|heic|svg|ico|icns|mp[34]|m4[av]|mov|avi|mkv|webm|wav|aac|flac|zip|gz|tgz|tar|7z|rar|dmg|pkg|app|crx|xpi|db|sqlite|sqlite3|ldb|sst";

const RULES: [RegExp, string][] = [
  [/\b(?:about|data|blob|javascript|mailto|file|chrome|ardia|chrome-extension|devtools|view-source):\S+/gi, "<url>"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]}]*/gi, "<url>"],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>"],
  [/(^|[\s(\[{=:,"'])~?\/?(?:[^\s/"'<>()\[\]{}]+\/)+[^\s"'<>()\[\]{},;]*/g, "$1<path>"],
  [/(^|[\s(\[{=:,])~(?=$|[\s)\]},;])/g, "$1<path>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>"],
  [/\[[0-9a-f:]*:[0-9a-f:]*\]/gi, "<ip>"],
  [new RegExp(`(^|[^\\w.<])[\\w-]+(?:[\\w.-]*)\\.(?:${FILE_EXTENSIONS})\\b`, "gi"), "$1<file>"],
  [/\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]+)\b(?::\d+)?/gi, "<host>"],
  [/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "<host>"],
  [/\b\d{5,}\b/g, "<n>"],
  [/\b(?:0x)?[0-9a-f]{12,}\b/gi, "<hex>"],
];

const QUOTES = new Set(['"', "“", "”", "‘", "’", "`"]);

function isAsciiWordCharacter(character: string | undefined): boolean {
  return !!character && /^[A-Za-z0-9]$/.test(character);
}

function untilFirstQuote(line: string): string {
  for (let i = 0; i < line.length; i++) {
    const character = line[i]!;
    if (QUOTES.has(character) || (character === "'" && !isAsciiWordCharacter(line[i - 1]))) return `${line.slice(0, i)}<text>`;
  }
  return line;
}

function withoutPartialLastWord(text: string): string {
  for (let i = text.length - 1; i >= 0; i--) if (/^\s$/.test(text[i]!)) return text.slice(0, i);
  return "";
}

export function scrubText(input: unknown, max = 200): string {
  if (typeof input !== "string") return "";
  let text = input.split(/\r?\n/, 1)[0] ?? "";
  const capped = text.length > max;
  if (capped) text = text.slice(0, max - 1);
  const beforeQuote = untilFirstQuote(text);
  const endsAtQuote = beforeQuote !== text;
  text = endsAtQuote ? beforeQuote : capped ? withoutPartialLastWord(text) : text;
  for (const [pattern, placeholder] of RULES) text = text.replace(pattern, placeholder);
  text = text.replace(/\s+/g, " ").trim();
  if (text.length >= max) return `${text.slice(0, max - 1)}…`;
  return capped && !endsAtQuote ? `${text}…` : text;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,60}$/;

export function errorType(error: unknown): string {
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && IDENTIFIER.test(name)) return name;
    const ctor = (error as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof ctor === "string" && IDENTIFIER.test(ctor)) return ctor;
    return "Error";
  }
  if (typeof error === "string") return "Error";
  return typeof error === "undefined" ? "Undefined" : error === null ? "Null" : "NonError";
}

const NATIVE_CALL = /^Calling the '([A-Za-z_$][\w$]{0,60})' function has failed$/;

export function errorMessage(error: unknown): string {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : error;
  if (typeof message !== "string") return "";
  const call = NATIVE_CALL.exec(message.split(/\r?\n/, 1)[0]!.trim());
  if (call) return `Calling the '${call[1]}' function has failed`;
  return scrubText(message, 300);
}

export function errorCode(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? code : null;
}

export type ExceptionFrame = {
  platform: "custom";
  lang: string;
  function: string;
  module: string;
  filename: string;
  lineno: number | null;
  colno: number | null;
  resolved: boolean;
  in_app: boolean;
  image_offset?: string;
};

function frameFunction(name: string | undefined): string {
  const fn = (name ?? "").trim();
  if (!fn || fn === "?" || fn === "anonymous" || fn === "<anonymous>") return "<anonymous>";
  return /^[\w$.<>\[\]# :-]{1,100}$/.test(fn) ? fn : "<anonymous>";
}

function frameFile(location: string | undefined): string {
  const raw = (location ?? "").replace(/^address at /, "").trim();
  if (!raw || raw === "native") return raw || "<unknown>";
  const base = raw.split(/[?#]|\/\/&/, 1)[0]!.split("/").filter(Boolean).at(-1) ?? "";
  return /^[\w.-]{1,80}$/.test(base) ? base : "<unknown>";
}

const V8_FRAME = /^\s*at (?:(.*?) \((.*?)\)|(.*?))\s*$/;
const JSC_FRAME = /^\s*(.*?)@(.*?)\s*$/;
const LOCATION = /^(.*?)(?::(\d+))?(?::(\d+))?$/;

export function parseStack(stack: unknown, limit = 50): ExceptionFrame[] {
  if (typeof stack !== "string") return [];
  const frames: ExceptionFrame[] = [];
  for (const line of stack.split("\n")) {
    let fn: string | undefined;
    let location: string | undefined;
    const v8 = V8_FRAME.exec(line);
    if (v8) {
      if (v8[2] !== undefined) [fn, location] = [v8[1], v8[2]];
      else location = v8[3];
    } else {
      const jsc = JSC_FRAME.exec(line);
      if (!jsc || !jsc[2]) continue;
      [fn, location] = [jsc[1], jsc[2]];
    }
    const loc = LOCATION.exec((location ?? "").replace(/^address at /, "")) ?? [];
    const filename = frameFile(loc[1]);
    frames.push({
      platform: "custom",
      lang: "javascript",
      function: frameFunction(fn),
      module: filename,
      filename,
      lineno: loc[2] ? Number(loc[2]) : null,
      colno: loc[3] ? Number(loc[3]) : null,
      resolved: false,
      in_app: filename !== "native" && filename !== "<unknown>" && !/^InternalBytecode/.test(filename),
    });
    if (frames.length >= limit) break;
  }
  return frames.reverse();
}

export type NativeFrame = { image: string; symbol?: string; symbolOffset?: number; offset?: number };
export type NativeImage = { name: string; uuid: string };

const OUR_IMAGES = /^(Ardia|ArdiaCore|ArdiaShell|Chromium Framework|Expo|ExpoModulesCore|React|hermes|RCT|Sparkle)/;
const STRIPPED_EXPORT = /^(?:ArdiaCoreMain|ChromeMain|ChromeWebAppShortcutCopierMain|ac_[a-z0-9_]+)$/;
const NEAREST_EXPORT_DISTANCE = 0x4000;

function nativeImageName(image: unknown): string {
  return typeof image === "string" ? frameFile(image.replace(/\s/g, "_")).replace(/_/g, " ") : "<unknown>";
}

function realSymbol(f: NativeFrame, inApp: boolean): string | null {
  if (typeof f.symbol !== "string" || !f.symbol) return null;
  if (inApp) {
    if (typeof f.symbolOffset === "number" ? f.symbolOffset >= NEAREST_EXPORT_DISTANCE : STRIPPED_EXPORT.test(f.symbol)) return null;
  }
  return f.symbol.replace(/\S*\/\S*/g, "<path>").replace(/"[^"]*"/g, "<text>").slice(0, 200);
}

export function nativeFrames(frames: NativeFrame[], limit = 64): ExceptionFrame[] {
  return frames.slice(0, limit).map((f): ExceptionFrame => {
    const image = nativeImageName(f.image);
    const inApp = OUR_IMAGES.test(image);
    const symbol = realSymbol(f, inApp);
    const offset = typeof f.offset === "number" && Number.isSafeInteger(f.offset) && f.offset >= 0 ? `0x${f.offset.toString(16)}` : null;
    return {
      platform: "custom",
      lang: "native",
      function: symbol ?? `${image} + ${offset ?? "0x0"}`,
      module: image,
      filename: image,
      lineno: null,
      colno: null,
      resolved: !!symbol,
      in_app: inApp,
      ...(offset ? { image_offset: offset } : {}),
    };
  }).reverse();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function nativeImages(images: unknown, limit = 24): NativeImage[] {
  if (!Array.isArray(images)) return [];
  return images.flatMap((i: Partial<NativeImage>) => {
    const uuid = typeof i?.uuid === "string" ? i.uuid.toLowerCase() : "";
    const name = nativeImageName(i?.name);
    return UUID.test(uuid) && OUR_IMAGES.test(name) ? [{ name, uuid }] : [];
  }).slice(0, limit);
}

const SYSTEM_NAME = /^[A-Z][A-Z0-9_ ()]{1,40}$/;
const EXCEPTION_NAME = /^[A-Z]{2,4}[A-Z][a-z][A-Za-z0-9]{1,60}$/;
const SUBTYPE = /^[A-Z][A-Z0-9_]{2,40}$/;

type NativeCrash = {
  exceptionType?: string;
  signal?: string;
  exceptionName?: string;
  exceptionReason?: string;
  exceptionSubtype?: string;
  frames: NativeFrame[];
  exceptionFrames?: NativeFrame[];
  images?: NativeImage[];
};

export function nativeCrashExceptions(report: NativeCrash) {
  const machType = report.exceptionType && SYSTEM_NAME.test(report.exceptionType) ? report.exceptionType : "Crash";
  const signal = report.signal && SYSTEM_NAME.test(report.signal) ? report.signal : null;
  const name = report.exceptionName && EXCEPTION_NAME.test(report.exceptionName) ? report.exceptionName : null;
  const subtype = report.exceptionSubtype && SUBTYPE.test(report.exceptionSubtype) ? report.exceptionSubtype : null;
  const images = nativeImages(report.images);
  const reason = scrubText(report.exceptionReason, 300) || null;
  const crash = { type: machType, value: signal ? `${machType} (${signal})` : machType, frames: nativeFrames(report.frames) };
  if (!report.exceptionFrames?.length && !name && !reason) return { name, signal, reason, subtype, images, exceptions: [crash] };
  const type = name ?? "NSException";
  const thrown = { type, value: reason ?? `Uncaught ${type}`, frames: nativeFrames(report.exceptionFrames ?? []) };
  return { name, signal, reason, subtype, images, exceptions: [thrown, crash] };
}

type PropertyValue = string | number | boolean | null;

export function cleanProperties(props: Record<string, unknown>): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!/^\$?[a-z][a-z0-9_]{0,48}$/i.test(key)) continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "string") out[key] = scrubText(value, 64);
  }
  return out;
}
