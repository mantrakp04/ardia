import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BUILT_IN_ENGINES, suggestRequestUrl } from "../../../packages/core/src/engines.ts";
import { createSuggestFetcher } from "../../../packages/core/src/suggestFetcher.ts";
import { CANCEL_SUGGEST_METHOD, SUGGEST_METHOD, SUGGEST_REPLY_LIMIT, hostSuggestFetch, suggestionEndpoints, suggestionRequestAllowed } from "./hostSuggestions.ts";

const nativePolicy = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_suggest_policy.h", import.meta.url), "utf8");
const nativeEndpoints = [...nativePolicy.slice(nativePolicy.indexOf("kEndpoints[]"), nativePolicy.indexOf("};", nativePolicy.indexOf("kEndpoints[]"))).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const nativeReplyLimit = Number(/kMaxReplyBytes = (\d+) \* (\d+);/.exec(nativePolicy).slice(1).reduce((a, b) => a * b));

function fakeHost({ supports = true, reply } = {}) {
  const calls = [];
  const host = {
    bootstrap: { windowId: "w1", profileId: "default", capabilities: supports ? [SUGGEST_METHOD, CANCEL_SUGGEST_METHOD] : [] },
    invoke(method, args) {
      const call = { method, args };
      calls.push(call);
      if (method === CANCEL_SUGGEST_METHOD) return Promise.resolve(null);
      return reply ? reply(call, calls.filter((c) => c.method === SUGGEST_METHOD).length) : Promise.resolve({ body: JSON.stringify([args.args[0], ["linux parity"]]) });
    },
    call: async () => "{}",
    onEvent: () => () => {},
  };
  return { host, calls };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const google = BUILT_IN_ENGINES.find((engine) => engine.id === "google");

test("the native allowlist and reply bound match the shared built-in engines exactly", () => {
  assert.deepEqual([...nativeEndpoints].sort(), [...suggestionEndpoints()].sort());
  assert.equal(nativeReplyLimit, SUGGEST_REPLY_LIMIT);
  for (const engine of BUILT_IN_ENGINES) {
    const url = suggestRequestUrl(engine, "linux parity ä/?#&'\\");
    if (url) assert.ok(suggestionRequestAllowed(url), url);
  }
});

test("requests outside the built-in suggestion endpoints are refused before reaching the host", async () => {
  const { host, calls } = fakeHost();
  const fetch = hostSuggestFetch(host);
  for (const url of [
    "https://example.com/?q=a",
    "https://suggestqueries.google.com/complete/search",
    "https://suggestqueries.google.com/complete/searchx?q=a",
    "https://suggestqueries.google.com.evil.example/complete/search?q=a",
    "http://suggestqueries.google.com/complete/search?q=a",
    "https://duckduckgo.com/ac/?q=a#x",
    "https://duckduckgo.com/ac/?q=a b",
    "https://extension.example/suggest?q=a",
  ]) await assert.rejects(fetch(url, { signal: new AbortController().signal }), { code: "ERR_SUGGEST_REFUSED" }, url);
  assert.deepEqual(calls, []);
});

test("a host without the suggestion service reports it unavailable and sends nothing", async () => {
  const { host, calls } = fakeHost({ supports: false });
  await assert.rejects(hostSuggestFetch(host)(suggestRequestUrl(google, "a"), { signal: new AbortController().signal }), { code: "ERR_UNAVAILABLE" });
  assert.deepEqual(calls, []);
});

test("the transport sends only the URL and returns the bounded body as text", async () => {
  const { host, calls } = fakeHost();
  const url = suggestRequestUrl(google, "linux");
  const response = await hostSuggestFetch(host)(url, { signal: new AbortController().signal });
  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(await response.text()), [url, ["linux parity"]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, SUGGEST_METHOD);
  assert.equal(calls[0].args.args[0], url);
  assert.match(calls[0].args.args[1], /^[A-Za-z0-9_-]{1,64}$/);
});

test("malformed or oversized host replies become an empty failed response", async () => {
  for (const body of [undefined, null, 7, { body: 3 }, { body: "x".repeat(SUGGEST_REPLY_LIMIT + 1) }]) {
    const { host } = fakeHost({ reply: async () => body });
    const response = await hostSuggestFetch(host)(suggestRequestUrl(google, "a"), { signal: new AbortController().signal });
    assert.equal(response.ok, false);
    assert.equal(await response.text(), "");
  }
});

test("cancellation rejects at once, and an already-cancelled request never reaches the host", async () => {
  const pending = deferred();
  const { host, calls } = fakeHost({ reply: () => pending.promise });
  const controller = new AbortController();
  const request = hostSuggestFetch(host)(suggestRequestUrl(google, "a"), { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  pending.resolve({ body: "[\"a\",[\"late\"]]" });
  const before = calls.length;
  await assert.rejects(hostSuggestFetch(host)(suggestRequestUrl(google, "b"), { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls.length, before);
});

test("with the shared fetcher, stale, failed, malformed and offline replies never replace the current suggestions", async () => {
  const replies = [deferred(), deferred(), deferred(), deferred()];
  const { host } = fakeHost({ reply: (_call, index) => replies[index - 1].promise });
  const fetcher = createSuggestFetcher({ fetch: hostSuggestFetch(host), delay: 0 });
  const results = [];
  fetcher.request(google, "lin", (list) => results.push(["lin", list]));
  await settle();
  fetcher.request(google, "linux", (list) => results.push(["linux", list]));
  await settle();
  replies[1].resolve({ body: JSON.stringify(["linux", ["linux parity"]]) });
  replies[0].resolve({ body: JSON.stringify(["lin", ["stale"]]) });
  await settle();
  assert.deepEqual(results, [["linux", ["linux parity"]]]);
  fetcher.request(google, "linux mint", (list) => results.push(["mint", list]));
  await settle();
  replies[2].reject(Object.assign(new Error("Search suggestions are unavailable"), { code: "ERR_SUGGEST" }));
  await settle();
  fetcher.request(google, "linux arch", (list) => results.push(["arch", list]));
  await settle();
  replies[3].resolve({ body: "<html>not json" });
  await settle();
  assert.deepEqual(results, [["linux", ["linux parity"]], ["arch", []]]);
  fetcher.cancel();
});

test("each request carries its own id and an abort cancels exactly that native fetch", async () => {
  const pending = [deferred(), deferred()];
  const { host, calls } = fakeHost({ reply: (_call, index) => pending[index - 1].promise });
  const fetch = hostSuggestFetch(host);
  const first = new AbortController();
  const a = fetch(suggestRequestUrl(google, "a"), { signal: first.signal });
  const b = fetch(suggestRequestUrl(google, "ab"), { signal: new AbortController().signal });
  await settle();
  const ids = calls.filter((call) => call.method === SUGGEST_METHOD).map((call) => call.args.args[1]);
  assert.equal(new Set(ids).size, 2);
  first.abort();
  await assert.rejects(a, { name: "AbortError" });
  await settle();
  assert.deepEqual(calls.filter((call) => call.method === CANCEL_SUGGEST_METHOD).map((call) => call.args.args), [[ids[0]]]);
  pending[1].resolve({ body: "[\"ab\",[\"abc\"]]" });
  assert.equal(await (await b).text(), "[\"ab\",[\"abc\"]]");
  pending[0].resolve({ body: "[]" });
  assert.equal(calls.filter((call) => call.method === CANCEL_SUGGEST_METHOD).length, 1);
});

test("a completed request is not cancelled afterwards and a host without cancellation is never asked", async () => {
  const { host, calls } = fakeHost();
  const controller = new AbortController();
  await hostSuggestFetch(host)(suggestRequestUrl(google, "done"), { signal: controller.signal });
  controller.abort();
  await settle();
  assert.equal(calls.filter((call) => call.method === CANCEL_SUGGEST_METHOD).length, 0);
  const pending = deferred();
  const legacy = fakeHost({ reply: () => pending.promise });
  legacy.host.bootstrap.capabilities = [SUGGEST_METHOD];
  const aborting = new AbortController();
  const request = hostSuggestFetch(legacy.host)(suggestRequestUrl(google, "x"), { signal: aborting.signal });
  aborting.abort();
  await assert.rejects(request, { name: "AbortError" });
  await settle();
  assert.equal(legacy.calls.filter((call) => call.method === CANCEL_SUGGEST_METHOD).length, 0);
});
