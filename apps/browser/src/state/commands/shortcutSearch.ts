import { matchesQuery } from "../../lib/textQuery";
import { commandKeywords } from "../omnibox/barActions";
import { formatShortcut, type Shortcut } from "./shortcuts";

export type SearchableShortcut = { id: string; title: string; path: readonly string[] };

export const shortcutMatchesQuery = (query: string, item: SearchableShortcut, combo: Shortcut) =>
  matchesQuery(query, item.title, item.path.join(" "), formatShortcut(combo), ...commandKeywords(item.id));
