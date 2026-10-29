import { createSuggestFetcher as createSharedSuggestFetcher, type FetchLike, type SuggestFetcher } from "../../../packages/core/src/suggestFetcher.ts";
import { ardiaHost } from "./host.ts";
import { hostSuggestFetch } from "./hostSuggestions.ts";

export type { FetchLike, SuggestFetcher };

export function createSuggestFetcher(options: Parameters<typeof createSharedSuggestFetcher>[0]): SuggestFetcher {
  return createSharedSuggestFetcher(ardiaHost ? { ...options, fetch: hostSuggestFetch(ardiaHost) } : options);
}
