import { writeDocument } from "../../platform/documents";
import { useBrowser } from "../browser/store";
import type { Settings } from "./settings";

const DOC = "secure-origins.json";

const store = () => useBrowser.getState();

export function normalizeSecureOrigin(typed: string): string {
  return typed.trim();
}

export function isSecureOriginPattern(typed: string): boolean {
  const origin = normalizeSecureOrigin(typed);
  if (!origin || /\s/.test(origin)) return false;
  if (origin.startsWith("*.")) {
    return /^\*\.([a-z0-9-]+\.)*[a-z0-9-]+$/i.test(origin) && !origin.endsWith(".");
  }
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname && url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function persistSecureOrigins(origins: string[]) {
  writeDocument(DOC, JSON.stringify(origins.filter((o) => typeof o === "string")));
}

export function startSecureOrigins() {
  const push = (settings: Settings) => persistSecureOrigins(Array.isArray(settings.secureOrigins) ? settings.secureOrigins : []);
  push(store().settings);
  useBrowser.subscribe((s, prev) => {
    if (s.settings.secureOrigins !== prev.settings.secureOrigins) push(s.settings);
  });
}

export async function addSecureOrigin(typed: string): Promise<string | null> {
  const origin = normalizeSecureOrigin(typed);
  if (!isSecureOriginPattern(origin)) return "Enter an origin like http://192.168.1.10:8080, or a host pattern like *.lab.test.";
  const origins = store().settings.secureOrigins;
  if (!origins.includes(origin)) store().updateSettings({ secureOrigins: [...origins, origin] });
  return null;
}

export function removeSecureOrigin(origin: string) {
  const origins = store().settings.secureOrigins;
  if (origins.includes(origin)) store().updateSettings({ secureOrigins: origins.filter((o) => o !== origin) });
}
