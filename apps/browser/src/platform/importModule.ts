import type * as ImportApi from "@ardia/import";

export type {
  BookmarkNode,
  BrowserProfile,
  BrowserSource,
  Credential,
  DiaTabsProfile,
  DiaTabsResult,
  ImportedExtension,
  ImportedFavicon,
  ImportedTab,
  ImportKind,
  ImportResult,
  SafariExport,
  SpaceSuggestion,
  SpaceSummary,
} from "@ardia/import";

let api: typeof ImportApi | null | undefined;

export function importModule(): typeof ImportApi | null {
  if (api === undefined) {
    try {
      api = require("@ardia/import") as typeof ImportApi;
    } catch {
      api = null;
    }
  }
  return api;
}
