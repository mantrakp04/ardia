import { matchActions } from "./fuzzy.ts";
import type { Suggestion } from "./suggest.ts";

export type ExtensionCandidate = {
  id: string;
  title: string;
  icon: string | null;
  action: boolean;
  options: boolean;
};

export type ExtensionRows = { rows: Suggestion[]; exact: boolean };

const NONE: ExtensionRows = { rows: [], exact: false };
const MIN_PARTIAL_QUERY = 3;
const MIN_SCORE = 50;

export function extensionSuggestions(query: string, extensions: readonly ExtensionCandidate[], limit = 2): ExtensionRows {
  if (!extensions.length) return NONE;
  const q = query.trim();
  const matches = matchActions(q, extensions, limit).filter((m) => m.exact || (q.length >= MIN_PARTIAL_QUERY && m.score >= MIN_SCORE));
  if (!matches.length) return NONE;
  const rows: Suggestion[] = [];
  matches.forEach(({ action: x }, i) => {
    if (x.action) rows.push({ kind: "extension", id: x.id, title: x.title, icon: x.icon, open: "action" });
    if (x.options && (i === 0 || !x.action)) rows.push({ kind: "extension", id: x.id, title: x.title, icon: x.icon, open: "options" });
  });
  return rows.length ? { rows, exact: matches[0]!.exact } : NONE;
}
