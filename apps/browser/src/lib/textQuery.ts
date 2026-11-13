import { urlForDisplay } from "@ardia/core";

export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

export const searchText = (...fields: string[]) => fields.map((f) => (/xn--/i.test(f) ? `${f} ${urlForDisplay(f)}` : f)).join(" ").toLowerCase();

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const words = queryWords(query);
  if (!words.length) return true;
  const hay = searchText(...fields);
  return words.every((w) => hay.includes(w));
}
