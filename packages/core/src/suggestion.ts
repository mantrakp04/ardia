import type { BangTable } from "./bangs.ts";
import type { ExtensionCandidate } from "./extensionRows.ts";
import type { SearchEngine } from "./engines.ts";
import type { ActionCandidate } from "./fuzzy.ts";
import type { SearchScope } from "./siteSearch.ts";

export type SuggestionSource = {
  tabs: readonly { id: string; url: string; title: string; favicon: string | null }[];
  history: readonly { url: string; title: string; favicon: string | null; visits: number; lastVisit: number }[];
  bookmarks?: readonly { url: string; title: string; favicon: string | null }[];
};

export type CommandAction = ActionCandidate & { icon?: string; hint?: string };

export type Suggestion =
  | {
      kind: "page";
      url: string;
      title: string;
      favicon: string | null;
      tabId?: string;
      bookmarked?: boolean;
      visited?: boolean;
    }
  | { kind: "search"; query: string; url: string; engine: string; suggested?: boolean; bang?: true }
  | { kind: "calc"; expression: string; value: string; url: string }
  | { kind: "action"; id: string; title: string; icon?: string; hint?: string }
  | { kind: "create"; id: string; title: string; url: string; site: string }
  | { kind: "extension"; id: string; title: string; icon: string | null; open: "action" | "options" };

export type SuggestionResult = {
  items: Suggestion[];
  completion: string;
};

export type SuggestOptions = {
  limit?: number;
  now?: number;
  engine?: Pick<SearchEngine, "name" | "url">;
  preference?: "website" | "search";
  remote?: readonly string[];
  actions?: readonly CommandAction[];
  extensions?: readonly ExtensionCandidate[];
  currentTabId?: string;
  currentUrl?: string;
  scope?: SearchScope | null;
  preventInline?: boolean;
  bangs?: BangTable | null;
};
