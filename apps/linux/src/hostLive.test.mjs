import assert from "node:assert/strict";
import test from "node:test";
import { hostLiveClient, LIVE_CAPABILITIES, liveError, liveRequestId, UNAVAILABLE_MESSAGE } from "./hostLive.ts";
import { linuxLiveSources, normalizeConfluenceSite } from "./liveSources.ts";
import { LiveError } from "../../browser/src/state/live/types.ts";

function fakeHost(handler, capabilities = [...LIVE_CAPABILITIES]) {
  const calls = [];
  return {
    calls,
    host: {
      bootstrap: { windowId: "w1", profileId: "default", capabilities },
      invoke: (method, { args }) => {
        calls.push({ method, args });
        return handler(method, args);
      },
    },
  };
}

test("native error codes keep the shared Live error meanings", () => {
  const coded = (code, message = "m") => Object.assign(new Error(message), { code });
  assert.equal(liveError(coded("ERR_LIVE_SIGNED_OUT"), true).kind, "signedOut");
  assert.equal(liveError(coded("ERR_LIVE_SSO"), true).kind, "sso");
  assert.equal(liveError(coded("ERR_LIVE_RATE_LIMITED"), true).kind, "rateLimited");
  assert.equal(liveError(coded("ERR_LIVE_NETWORK"), true).kind, "network");
  assert.equal(liveError(coded("ERR_LIVE_NOT_CONNECTED"), true).kind, "signedOut");
  assert.equal(liveError(coded("ERR_LIVE_NOT_CONNECTED"), false).kind, "notConfigured");
  const locked = liveError(coded("ERR_LIVE_KEYRING_LOCKED", "Unlock your keyring"), true);
  assert.equal(locked.kind, "keyringLocked");
  assert.equal(locked.message, "Unlock your keyring");
  assert.equal(liveError(coded("ERR_LIVE_KEYRING_UNAVAILABLE", "No keyring"), true).kind, "keyringUnavailable");
  assert.equal(liveError(coded("ERR_PRIVATE_SERVICE"), true).kind, "other");
  const same = new LiveError("network", "x");
  assert.equal(liveError(same, true), same);
});

test("request ids fit the native id rules and never repeat", () => {
  const ids = new Set(Array.from({ length: 200 }, () => liveRequestId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
});

test("an unavailable host fails explicitly and never invokes", async () => {
  const { host, calls } = fakeHost(() => Promise.resolve({ body: "{}" }), []);
  const client = hostLiveClient(host);
  assert.equal(client.available(), false);
  await assert.rejects(client.request("github", "graphql", { query: "query { viewer { login } }" }), (error) => error instanceof LiveError && error.message === UNAVAILABLE_MESSAGE);
  await assert.rejects(client.disconnect("github"), LiveError);
  assert.deepEqual(calls, []);
});

test("aborting cancels the same native request and ignores its late reply", async () => {
  let release;
  const { host, calls } = fakeHost((method) => (method === "ArdiaLive.cancel" ? Promise.resolve(true) : new Promise((resolve) => (release = resolve))));
  const client = hostLiveClient(host);
  const abort = new AbortController();
  const pending = client.request("notion", "search", {}, { signal: abort.signal });
  await Promise.resolve();
  await Promise.resolve();
  abort.abort();
  await assert.rejects(pending, (error) => error instanceof LiveError && error.message === "Cancelled");
  release({ body: "{\"results\":[]}" });
  assert.equal(calls[0].method, "ArdiaLive.request");
  assert.deepEqual(calls[1], { method: "ArdiaLive.cancel", args: [calls[0].args[3]] });
  const before = calls.length;
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.request("notion", "search", {}, { signal: aborted.signal }), LiveError);
  assert.equal(calls.length, before, "an already-aborted request never reaches the host");
});

test("replies are parsed from the bounded native body and unreadable bodies are errors", async () => {
  const replies = [{ body: "{\"ok\":1}" }, { body: "not json" }, { nobody: true }];
  const { host } = fakeHost(() => Promise.resolve(replies.shift()));
  const client = hostLiveClient(host);
  assert.deepEqual(await client.request("notion", "users"), { ok: 1 });
  await assert.rejects(client.request("notion", "users"), /unreadable/);
  await assert.rejects(client.request("notion", "users"), /unreadable/);
});

test("sources call only fixed provider operations and never pass a token back out", async () => {
  const { host, calls } = fakeHost((method, args) => {
    if (method === "ArdiaLive.connect") return Promise.resolve({ accountId: "acc", displayName: "Alice" });
    return Promise.resolve({ body: JSON.stringify({ results: [], _links: { base: "https://acme.atlassian.net/wiki" } }) });
  });
  const linux = linuxLiveSources(hostLiveClient(host));
  await linux.connectConfluence(" acme.atlassian.net// ", " a@b.c ", " token ");
  assert.deepEqual(calls[0].args.slice(0, 2), ["confluence", { site: "https://acme.atlassian.net", email: "a@b.c", token: "token" }]);
  assert.deepEqual(await linux.SOURCES.confluence.fetch({ sources: ["confluence"], filters: { authored: true, reviewRequests: true } }), []);
  assert.deepEqual(calls[1].args.slice(0, 3), ["confluence", "search", {}]);
  assert.equal(normalizeConfluenceSite("https://x.atlassian.net/"), "https://x.atlassian.net");
  assert.equal(normalizeConfluenceSite("http://x.atlassian.net"), "http://x.atlassian.net");
});

test("a bridge timeout cancels the native call so a late save cannot land", async () => {
  const { host, calls } = fakeHost((method) => (method === "ArdiaLive.cancel" ? Promise.resolve(true) : Promise.reject(new Error("Native request timed out: ArdiaLive.connect"))));
  const client = hostLiveClient(host);
  await assert.rejects(client.connect("notion", { token: "secret_x" }), /timed out/);
  assert.deepEqual(calls.map((c) => c.method), ["ArdiaLive.connect", "ArdiaLive.cancel"]);
  assert.deepEqual(calls[1].args, [calls[0].args[2]]);
  const native = fakeHost(() => Promise.reject(Object.assign(new Error("Signed out"), { code: "ERR_LIVE_SIGNED_OUT" })));
  await assert.rejects(hostLiveClient(native.host).request("notion", "users"), LiveError);
  assert.deepEqual(native.calls.map((c) => c.method), ["ArdiaLive.request"]);
});
