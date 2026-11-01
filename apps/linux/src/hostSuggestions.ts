import { BUILT_IN_ENGINES } from "../../../packages/core/src/engines.ts";
import type { FetchLike } from "../../../packages/core/src/suggestFetcher.ts";
import { hostSupports, invokeHost, type ArdiaHost } from "./host.ts";

export const SUGGEST_METHOD = "ArdiaSearch.suggest";
export const CANCEL_SUGGEST_METHOD = "ArdiaSearch.cancelSuggest";
export const SUGGEST_REPLY_LIMIT = 64 * 1024;

type SuggestingEngine = { suggestUrl?: string };

function endpointOf(suggestUrl: string) {
  try {
    const url = new URL(suggestUrl.replaceAll("%s", "q"));
    return url.protocol === "https:" && !url.username && !url.password ? [`${url.origin}${url.pathname}`] : [];
  } catch {
    return [];
  }
}

export const suggestionEndpoints = (engines: readonly SuggestingEngine[] = BUILT_IN_ENGINES) =>
  [...new Set(engines.flatMap((engine) => engine.suggestUrl ? endpointOf(engine.suggestUrl) : []))];

const builtInEndpoints = suggestionEndpoints();

const queriesEndpoint = (url: string, endpoint: string) =>
  url.length > endpoint.length + 1 && url.startsWith(endpoint) && url[endpoint.length] === "?";

export function suggestionRequestAllowed(url: string, extensionEndpoints: readonly string[] = []) {
  if (!url || url.length > 2048 || /[^\x21-\x7e]|[#\\]/.test(url)) return false;
  return builtInEndpoints.some((endpoint) => queriesEndpoint(url, endpoint)) ||
    extensionEndpoints.some((endpoint) => /^https:\/\/[^/@{}%?]+\/[^?{}]*$/.test(endpoint) && queriesEndpoint(url, endpoint));
}

export function canonicalSuggestionRequest(url: string) {
  const query = url.indexOf("?");
  if (query < 0 || url.length > 2048 || /[^\x21-\x7e]|[#\\]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.username || parsed.password ? null : `${parsed.origin}${parsed.pathname}${url.slice(query)}`;
  } catch {
    return null;
  }
}

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const aborted = () => Object.assign(new Error("The suggestion request was cancelled"), { name: "AbortError" });
const empty = { ok: false, text: async () => "" };
let sequence = 0;

export function hostSuggestFetch(host: ArdiaHost, extensionEndpoints: () => readonly string[] = () => []): FetchLike {
  return (url, { signal }) => {
    if (signal.aborted) return Promise.reject(aborted());
    if (!hostSupports(SUGGEST_METHOD, host)) return Promise.reject(failure("ERR_UNAVAILABLE", "Search suggestions are unavailable in this Linux host"));
    const request = canonicalSuggestionRequest(url);
    if (!request || !suggestionRequestAllowed(request, extensionEndpoints())) return Promise.reject(failure("ERR_SUGGEST_REFUSED", "Search suggestions are limited to the built-in engines and engines added by extensions"));
    const id = `suggest-${++sequence}`;
    const cancellable = hostSupports(CANCEL_SUGGEST_METHOD, host);
    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        if (cancellable) void invokeHost(CANCEL_SUGGEST_METHOD, { args: [id] }, host).catch(() => {});
        reject(aborted());
      };
      signal.addEventListener("abort", abort, { once: true });
      invokeHost<unknown>(SUGGEST_METHOD, { args: [request, id] }, host).then((reply) => {
        signal.removeEventListener("abort", abort);
        if (settled) return;
        settled = true;
        const body = reply && typeof reply === "object" && typeof (reply as { body?: unknown }).body === "string" ? (reply as { body: string }).body : null;
        if (body === null || body.length > SUGGEST_REPLY_LIMIT) return resolve(empty);
        resolve({ ok: true, text: async () => body });
      }, (error: unknown) => {
        signal.removeEventListener("abort", abort);
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  };
}
