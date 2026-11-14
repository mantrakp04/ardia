import type { FetchLike } from "@ardia/core";
import { fetchSearchSuggestions, stopSearchSuggestions } from "../../platform/search";
import { noteSearchSuggest } from "../telemetry/track";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { useBrowser } from "../browser/store";

const BLOCKED_STATUSES = new Set([403, 429]);
let nextRequestId = 1;

export const remoteSuggestionsAllowed = (profileId: string) => !isIncognitoProfile(profileId);

export const suggestProfileKey = (profileId: string) => engineProfile(useBrowser.getState(), profileId);

export function browserSuggestFetch(profile: string): FetchLike {
  return async (url, { signal }) => {
    const id = nextRequestId++;
    const stop = () => void stopSearchSuggestions(profile, id).catch(() => {});
    signal.addEventListener("abort", stop, { once: true });
    try {
      const reply = await fetchSearchSuggestions(profile, url, id);
      if (reply.stopped || signal.aborted) throw new Error("suggestion request stopped");
      noteSearchSuggest(reply.status === 200 ? "ok" : BLOCKED_STATUSES.has(reply.status) ? "blocked" : "failed");
      const body = reply.body ?? "";
      return { ok: reply.status === 200 && !!body, text: async () => body };
    } finally {
      signal.removeEventListener("abort", stop);
    }
  };
}
