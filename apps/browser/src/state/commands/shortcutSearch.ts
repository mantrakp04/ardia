import { matchesQuery } from "../../lib/textQuery";
import type { MenuShortcut } from "../../platform/commands";
import { commandKeywords } from "../omnibox/barActions";
import { formatShortcut, type Shortcut } from "./shortcuts";

export type SearchableShortcut = Pick<MenuShortcut, "id" | "title" | "path">;

export const shortcutMatchesQuery = (query: string, item: SearchableShortcut, combo: Shortcut) =>
  matchesQuery(query, item.title, item.path.join(" "), formatShortcut(combo), ...commandKeywords(item.id));
