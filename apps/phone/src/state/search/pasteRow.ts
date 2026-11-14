import type { TrayRow } from "./omnibox.ts";

export type PasteOffer = "link" | "text";

export const PASTE_ROW_KEY = "paste";

export function withPasteRow(rows: TrayRow[], typed: string, offer: PasteOffer | null): TrayRow[] {
  if (typed.trim() || !offer) return rows;
  const detail = offer === "link" ? "Link You Copied" : "Text You Copied";
  return [{ key: PASTE_ROW_KEY, kind: "paste", title: "Paste and Go", detail, url: "", offer }, ...rows];
}
