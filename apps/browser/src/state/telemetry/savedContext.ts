import { isFields } from "../../lib/decode";

export type SavedContext = Record<string, string | number | boolean | null>;

export function readContext(value: unknown): SavedContext | null {
  if (!isFields(value) || typeof value.at !== "number") return null;
  const out: SavedContext = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) out[key] = v;
  }
  return out;
}
