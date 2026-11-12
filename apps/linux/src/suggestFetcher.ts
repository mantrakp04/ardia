import { createSuggestFetcher as createSharedSuggestFetcher, type FetchLike, type SuggestFetcher } from "../../../packages/core/src/suggestFetcher.ts";
import { ardiaHost } from "./host.ts";
import { hostSuggestFetch, suggestionEndpoints } from "./hostSuggestions.ts";

export type { FetchLike, SuggestFetcher };

const browserStore = () => import("../../browser/src/state/browser/store");
const suggestTelemetry = () => import("../../browser/src/state/telemetry/track");

export function createSuggestFetcher(options: Parameters<typeof createSharedSuggestFetcher>[0]): SuggestFetcher {
  if (!ardiaHost) return createSharedSuggestFetcher(options);
  let extensionEndpoints: readonly string[] = [];
  const hostFetch = hostSuggestFetch(ardiaHost, () => extensionEndpoints);
  const fetch: FetchLike = async (url, init) => {
    const [{ useBrowser }, { noteSearchSuggest }] = await Promise.all([browserStore(), suggestTelemetry()]);
    extensionEndpoints = suggestionEndpoints(useBrowser.getState().settings.extensionSearchEngines);
    const reply = await hostFetch(url, init);
    noteSearchSuggest(reply.ok ? "ok" : "failed");
    return reply;
  };
  return createSharedSuggestFetcher({ ...options, fetch });
}
