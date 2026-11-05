import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { providerApprovalKey } = await import("@ardia/core");
const { DEFAULT_SETTINGS } = await import("../settings/settings.ts");
const { readConfig } = await import("../config/configSettings.ts");
const { registerOmniboxProvider, useRegisteredProviders } = await import("./providers.ts");
const { createProviderQueries } = await import("./providerQueries.ts");
const { configProviders, pendingConfigProviders } = await import("./configProviders.ts");
const { approveOmniboxProvider, revokeOmniboxProvider } = await import("./providerApproval.ts");
const { fetchRemoteRows, forgetRemoteProviderCache, REMOTE_PROVIDER } = await import("./remoteProvider.ts");
const { launch } = await import("../../test-native/shell.ts");
const { reloadLaunchConfigForTests } = await import("../../platform/launchConfig.ts");
const asTestInstance = (on) => {
  launch.testInstance = on;
  reloadLaunchConfigForTests();
};

const flush = () => new Promise((r) => setImmediate(r));
const ctx = { partition: "default|normal", privateContext: false };

test("registerOmniboxProvider adds, replaces by id, and its return removes it", () => {
  const a = { id: "p", title: "P", keyword: "pp", query: async () => [] };
  const off = registerOmniboxProvider(a);
  assert.deepEqual(useRegisteredProviders.getState().list.map((p) => p.id), ["p"]);
  const b = { ...a, title: "P2" };
  const offB = registerOmniboxProvider(b);
  assert.deepEqual(useRegisteredProviders.getState().list.map((p) => p.title), ["P2"]);
  off();
  assert.equal(useRegisteredProviders.getState().list.length, 1, "removing a replaced provider leaves its replacement");
  offB();
  assert.equal(useRegisteredProviders.getState().list.length, 0);
  assert.throws(() => registerOmniboxProvider({ id: "x", title: "X", keyword: "a b", query: async () => [] }), /keyword/);
});

test("queries stream per provider; a slow one hits its deadline and never holds the others", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queries = createProviderQueries(60);
  const seen = [];
  let slowSignal;
  queries.run("hi", [
    { id: "fast", title: "Fast", query: async (t) => [{ title: t, url: "https://fast.example/" }] },
    { id: "slow", title: "Slow", query: (t, signal) => ((slowSignal = signal), new Promise(() => {})) },
    { id: "throws", title: "Throws", query: () => { throw new Error("boom"); } },
    { id: "rejects", title: "Rejects", query: async () => { throw new Error("boom"); } },
  ], (s) => seen.push(s.id));
  await flush();
  assert.deepEqual(seen, ["fast"]);
  t.mock.timers.tick(60);
  await flush();
  assert.deepEqual(seen, ["fast"], "the slow one never answers after its deadline");
  assert.equal(slowSignal.aborted, true, "its signal aborts at the deadline");
});

test("every run aborts the previous one's queries and drops their late answers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const queries = createProviderQueries(1000);
  const seen = [];
  const signals = [];
  const provider = { id: "p", title: "P", query: (t, signal) => (signals.push(signal), wait(20).then(() => [{ title: t, url: "https://p.example/" }])) };
  queries.run("a", [provider], (s) => seen.push(s.rows[0].title));
  queries.run("ab", [provider], (s) => seen.push(s.rows[0].title));
  assert.equal(signals[0].aborted, true);
  t.mock.timers.tick(20);
  await flush();
  assert.deepEqual(seen, ["ab"]);
  queries.run("abc", [provider], (s) => seen.push(s.rows[0].title));
  queries.cancel();
  assert.equal(signals[2].aborted, true, "closing the bar aborts what's in flight");
  t.mock.timers.tick(20);
  await flush();
  assert.deepEqual(seen, ["ab"]);
});

test("static keyword providers and URL templates need no approval; global and remote ones wait for it", async () => {
  const entries = [
    { keyword: "t", rows: [{ title: "Wiki", url: "https://wiki.example.com/" }, { title: "Board", url: "https://board.example.com/" }] },
    { keyword: "go", url: "https://linear.app/team/issue/{query}" },
    { title: "Team", rows: [{ title: "Wiki", url: "https://wiki.example.com/" }] },
    { keyword: "s", suggest: "https://s.example.com/?q={query}" },
  ];
  const ids = () => configProviders(entries, ctx).map((p) => `${p.id}${p.sendsInput ? "+net" : ""}`);
  assert.deepEqual(ids(), ["config:t", "config:go", "config:s"]);
  assert.deepEqual(pendingConfigProviders(entries).map((p) => p.title), ["Team", "s.example.com"]);
  approveOmniboxProvider(providerApprovalKey(entries[2]));
  approveOmniboxProvider(providerApprovalKey(entries[3]));
  assert.deepEqual(ids(), ["config:t", "config:go", "config:team", "config:s+net"]);
  assert.deepEqual(configProviders(entries, { ...ctx, privateContext: true }).map((p) => `${p.id}${p.sendsInput ? "+net" : ""}`), ["config:t", "config:go", "config:team", "config:s"], "no network in a private window");
  const edited = [...entries.slice(0, 3), { keyword: "s", suggest: "https://other.example.com/?q={query}" }];
  assert.deepEqual(configProviders(edited, ctx).map((p) => `${p.id}${p.sendsInput ? "+net" : ""}`).at(-1), "config:s", "an edit needs approval again");
  const [t] = configProviders(entries, ctx);
  assert.deepEqual((await t.query("", new AbortController().signal)).map((r) => r.title), ["Wiki", "Board"], "keyword mode with nothing typed lists every row");
  assert.deepEqual((await t.query("boa", new AbortController().signal)).map((r) => r.title), ["Board"]);
  revokeOmniboxProvider(providerApprovalKey(entries[2]));
  revokeOmniboxProvider(providerApprovalKey(entries[3]));
});

test("config.json: a bad provider is reported and skipped, the others apply", () => {
  const { patch, problems } = readConfig(
    JSON.stringify({ settings: { omniboxProviders: [{ keyword: "go", url: "https://linear.app/{query}" }, { keyword: "x", url: "javascript:{query}" }] } }),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(patch, { omniboxProviders: [{ keyword: "go", url: "https://linear.app/{query}" }] });
  assert.deepEqual(problems, ["config.json: omniboxProviders[1].url must be an http or https URL containing {query}"]);
  assert.deepEqual(readConfig(JSON.stringify({ settings: { omniboxProviders: 3 } }), DEFAULT_SETTINGS).problems, ["config.json: omniboxProviders must be a list of providers"]);
});

function fakeFetch(handler) {
  const calls = [];
  const before = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    readyState = 0;
    status = 0;
    responseText = "";
    responseURL = "";
    headers = {};
    sent = { headers: {} };
    open(method, url) {
      this.sent.method = method;
      this.sent.url = url;
    }
    setRequestHeader(name, value) {
      this.sent.headers[name] = value;
    }
    getResponseHeader(name) {
      return this.headers[name.toLowerCase()] ?? null;
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    send() {
      const call = { url: this.sent.url, xhr: this, delivered: 0 };
      calls.push(call);
      void Promise.resolve(handler(this.sent.url)).then((r) => {
        if (this.aborted) return;
        this.status = r.status ?? 200;
        this.responseURL = r.url || this.sent.url;
        this.headers = r.headers ?? {};
        this.readyState = 2;
        this.onreadystatechange?.();
        for (const chunk of r.chunks) {
          if (this.aborted) return;
          this.responseText += chunk;
          call.delivered += 1;
          this.onprogress?.({ loaded: this.responseText.length });
        }
        if (this.aborted) return;
        this.readyState = 4;
        this.onload?.();
      });
    }
  };
  return { calls, restore: () => (globalThis.XMLHttpRequest = before) };
}
const reply = (body, { url = "", headers = {}, chunk = 0 } = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const chunks = chunk ? Array.from({ length: Math.ceil(text.length / chunk) }, (_, i) => text.slice(i * chunk, (i + 1) * chunk)) : [text];
  return { url, headers, chunks };
};

const debounced = (t, pending) => {
  t.mock.timers.tick(REMOTE_PROVIDER.debounceMs);
  return pending;
};

test("remote fetch: debounced, no cookies or referrer, cached per profile, aborted by the next key", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  forgetRemoteProviderCache();
  const f = fakeFetch(() => reply(["q", ["one", "two"]]));
  try {
    const template = "https://s.example.com/?q={query}";
    assert.deepEqual(await debounced(t, fetchRemoteRows(template, "on", "z|normal", new AbortController().signal)), [], "a text without a URL and no link template is dropped");
    f.calls.length = 0;
    const rows = await debounced(t, fetchRemoteRows(template, "on", "a|normal", new AbortController().signal, "https://go.example.com/{query}"));
    assert.deepEqual(rows, [{ title: "one", url: "https://go.example.com/one" }, { title: "two", url: "https://go.example.com/two" }], "through the provider's link template, never the endpoint");
    assert.equal(f.calls[0].url, "https://s.example.com/?q=on");
    assert.equal(f.calls[0].xhr.withCredentials, false);
    assert.equal(f.calls[0].xhr.sent.method, "GET");
    await fetchRemoteRows(template, "on", "a|normal", new AbortController().signal, "https://go.example.com/{query}");
    assert.equal(f.calls.length, 1, "cached");
    await debounced(t, fetchRemoteRows(template, "on", "b|normal", new AbortController().signal, "https://go.example.com/{query}"));
    assert.equal(f.calls.length, 2, "another profile has its own cache");
    const typing = new AbortController();
    const pending = fetchRemoteRows(template, "onw", "a|normal", typing.signal);
    typing.abort();
    assert.deepEqual(await pending, []);
    t.mock.timers.tick(REMOTE_PROVIDER.debounceMs + 20);
    await flush();
    assert.equal(f.calls.length, 2, "an aborted key never reaches the network");
  } finally {
    f.restore();
  }
});

test("remote fetch: private hosts, loopback outside a test instance, a redirect away, a large reply are all dropped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  forgetRemoteProviderCache();
  const big = "x".repeat(REMOTE_PROVIDER.maxBytes * 4);
  const f = fakeFetch((url) =>
    url.includes("big") ? reply(big, { chunk: 16_384 }) : url.includes("long") ? reply("[]", { headers: { "content-length": String(REMOTE_PROVIDER.maxBytes + 1) } }) : url.includes("hop") ? reply([{ title: "a", url: "https://a.com/" }], { url: "https://10.0.0.1/x" }) : reply([{ title: "a", url: "https://a.com/" }]),
  );
  const signal = new AbortController().signal;
  try {
    assert.deepEqual(await fetchRemoteRows("https://192.168.1.10/?q={query}", "x", "p", signal), []);
    assert.deepEqual(await fetchRemoteRows("http://127.0.0.1:9/?q={query}", "x", "p", signal), []);
    assert.equal(f.calls.length, 0);
    asTestInstance(true);
    assert.deepEqual(await debounced(t, fetchRemoteRows("http://127.0.0.1:9/?q={query}", "x", "p", signal)), [{ title: "a", url: "https://a.com/" }], "loopback http in a test instance");
    asTestInstance(false);
    assert.deepEqual(await debounced(t, fetchRemoteRows("https://hop.example.com/?q={query}", "x", "p", signal)), []);
    assert.deepEqual(await debounced(t, fetchRemoteRows("https://big.example.com/?q={query}", "x", "p", signal)), []);
    const bigCall = f.calls.find((c) => c.url.includes("big"));
    assert.equal(bigCall.xhr.aborted, true, "aborted while receiving");
    assert.equal(bigCall.delivered, Math.floor(REMOTE_PROVIDER.maxBytes / 16_384) + 1, "stopped at the chunk that crossed the cap, not after the whole 512 KB");
    assert.deepEqual(await debounced(t, fetchRemoteRows("https://long.example.com/?q={query}", "x", "p", signal)), []);
  } finally {
    asTestInstance(false);
    f.restore();
  }
});

test("a request cancelled before it is sent never reaches the network", async () => {
  const { cappedRequest } = await import("./remoteProvider.ts");
  const f = fakeFetch(() => reply([]));
  try {
    const cancelled = new AbortController();
    cancelled.abort();
    assert.equal(await cappedRequest("https://s.example.com/?q=x", cancelled.signal, REMOTE_PROVIDER.maxBytes), null);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});
