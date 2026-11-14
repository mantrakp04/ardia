import { isFields } from "../../lib/decode";
import { WEBUI_PAGE_VALUE } from "./sanitize";

export type SavedContext = Record<string, string | number | boolean | null> & { webui_page?: string | null };

export function readContext(value: unknown): SavedContext | null {
  if (!isFields(value) || typeof value.at !== "number") return null;
  const out: SavedContext = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "webui_page") out[key] = typeof v === "string" && WEBUI_PAGE_VALUE.test(v) ? v : null;
    else if (v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) out[key] = v;
  }
  return out;
}
