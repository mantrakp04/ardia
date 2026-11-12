import { fromBase64 } from "../../import/bytes";
import { callError, isFields, ok, type Desktop, type Fields, type Handlers } from "./calling";
import { desktopOf } from "./exports";
import { sha256 } from "./sha256";

const LARGEST_JSON_BYTES = 4 << 20;
const LARGEST_ICON_BYTES = 2 << 20;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

function withoutTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === ",") {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next]!)) next++;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    out += c;
  }
  return out;
}

export function withoutComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return withoutTrailingCommas(out);
}

function parsed(text: string | null): Fields | undefined {
  if (text == null) return undefined;
  try {
    const value: unknown = JSON.parse(withoutComments(text.replace(/^﻿/, "")));
    return isFields(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const joinPath = (folder: string, relative: string) => `${folder.replace(/[\\/]+$/, "")}\\${relative.replace(/\//g, "\\")}`;

export function insideFolder(relative: string): string | undefined {
  const parts: string[] = [];
  for (const part of relative.replace(/^[\\/]+/, "").split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part.includes(":")) return undefined;
    parts.push(part);
  }
  return parts.length ? parts.join("/") : undefined;
}

export function idForKey(base64Key: string): string | undefined {
  const key = fromBase64(base64Key);
  if (!key.length) return undefined;
  const hash = sha256(key);
  let id = "";
  for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (hash[i]! >> 4), 97 + (hash[i]! & 15));
  return id;
}

export function iconPath(icons: unknown, size: number): string | undefined {
  if (typeof icons === "string") return icons;
  if (!isFields(icons)) return undefined;
  let best: string | undefined;
  let bestSize = 0;
  for (const [key, value] of Object.entries(icons)) {
    const s = parseInt(key, 10);
    if (typeof value !== "string" || !(s > 0)) continue;
    const better = best === undefined || (bestSize < size ? s > bestSize : s >= size && s < bestSize);
    if (better) {
      best = value;
      bestSize = s;
    }
  }
  return best;
}

const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
const isHostPattern = (s: string) => s === "<all_urls>" || s.includes("://");

type Messages = Record<string, { message: string }>;

async function messagesOf(desktop: Desktop, folder: string, manifest: Fields, uiLocale: string): Promise<Messages> {
  const candidates: string[] = [];
  const ui = uiLocale.replace(/-/g, "_");
  const primary = ui === "en" ? "en_US" : ui;
  if (primary) candidates.push(primary, ...(primary.includes("_") ? [primary.slice(0, primary.indexOf("_"))] : []));
  if (typeof manifest.default_locale === "string") candidates.push(manifest.default_locale);
  candidates.push("en", "en_US");
  const merged: Messages = {};
  for (const locale of [...new Set(candidates)]) {
    const raw = await desktop.readText(joinPath(folder, `_locales/${locale}/messages.json`), LARGEST_JSON_BYTES).catch(() => null);
    const messages = parsed(raw);
    if (!messages) continue;
    const valid = Object.values(messages).every((entry) => isFields(entry) && typeof entry.message === "string");
    if (!valid) throw callError("ERR_ENGINE", `The localization file _locales/${locale}/messages.json is invalid`);
    for (const [key, entry] of Object.entries(messages)) merged[key] ??= entry as { message: string };
  }
  return merged;
}

function localize(value: unknown, messages: Messages): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("__MSG_") || !value.endsWith("__") || value.length <= 8) return value;
  const key = value.slice(6, -2).toLowerCase();
  const found = Object.keys(messages).find((k) => k.toLowerCase() === key);
  return found ? messages[found]!.message : value;
}

async function dataUrl(desktop: Desktop, folder: string, relative: string | undefined): Promise<string | undefined> {
  const inside = relative ? insideFolder(relative) : undefined;
  if (!inside) return undefined;
  const type = IMAGE_TYPES[inside.slice(inside.lastIndexOf(".") + 1).toLowerCase()];
  if (!type) return undefined;
  const base64 = await desktop.readBase64(joinPath(folder, inside), LARGEST_ICON_BYTES).catch(() => null);
  return base64 ? `data:${type};base64,${base64}` : undefined;
}

const dropUndefined = (fields: Fields): Fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export async function readUnpacked(desktop: Desktop, folder: string, uiLocale = "en"): Promise<Fields> {
  const manifest = parsed(await desktop.readText(joinPath(folder, "manifest.json"), LARGEST_JSON_BYTES).catch(() => null));
  if (!manifest) throw callError("ERR_ENGINE", "Manifest file is missing or unreadable");
  const messages = await messagesOf(desktop, folder, manifest, uiLocale);
  const action = [manifest.action, manifest.browser_action, manifest.page_action].find(isFields);
  const hosts = new Set<string>();
  const permissions: string[] = [];
  for (const p of strings(manifest.permissions)) (isHostPattern(p) ? hosts.add(p) : permissions.push(p));
  for (const p of strings(manifest.host_permissions)) hosts.add(p);
  for (const script of Array.isArray(manifest.content_scripts) ? manifest.content_scripts.filter(isFields) : []) for (const m of strings(script.matches)) hosts.add(m);
  const options = isFields(manifest.options_ui) ? manifest.options_ui.page : manifest.options_page;
  const panel = isFields(manifest.side_panel) ? manifest.side_panel.default_path : undefined;
  const popup = action && typeof action.default_popup === "string" && action.default_popup ? action.default_popup : undefined;
  return dropUndefined({
    name: localize(manifest.name, messages) ?? "",
    shortName: localize(manifest.short_name, messages),
    version: typeof manifest.version === "string" ? manifest.version : "",
    description: localize(manifest.description, messages) ?? "",
    manifestVersion: typeof manifest.manifest_version === "number" ? manifest.manifest_version : 2,
    icon: await dataUrl(desktop, folder, iconPath(manifest.icons, 128)),
    permissions,
    optionalPermissions: strings(manifest.optional_permissions),
    hostPermissions: [...hosts],
    hasAction: action !== undefined,
    popup,
    actionTitle: action ? localize(action.default_title, messages) : undefined,
    actionIcon: await dataUrl(desktop, folder, (action ? iconPath(action.default_icon, 32) : undefined) ?? iconPath(manifest.icons, 32)),
    optionsPage: typeof options === "string" ? options : undefined,
    sidePanel: typeof panel === "string" ? panel : undefined,
    incognitoSplit: manifest.incognito === "split",
    homepageUrl: typeof manifest.homepage_url === "string" ? manifest.homepage_url : undefined,
    id: typeof manifest.key === "string" ? idForKey(manifest.key) : undefined,
    path: folder,
  });
}

export const unpackedCalls: Handlers = {
  chooseFolder: async (_args, engine) => ok(await desktopOf(engine).pickFolder("Select")),
  inspectUnpacked: async (args, engine) => ok(await readUnpacked(desktopOf(engine), args.text("path"))),
};
