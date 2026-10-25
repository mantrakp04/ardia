import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { grant, revoke, runOnPage } from "./blocker-scripts.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const ext = `${here}../vendor/unified-blocker/ext`;
const core = `${ext}/js/adn/core.js`;
const vapiBackground = `${ext}/js/vapi-background.js`;
if (![core, vapiBackground].every(existsSync)) {
  throw new Error("AdNauseam test dependency is missing. From the repository root, run bash packages/ardiacore/scripts/unified-blocker.sh before this test.");
}

const imports = {};
for (const file of [core, vapiBackground]) {
  for (const [, names, from] of readFileSync(file, "utf8").matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)'/gm)) {
    const named = /\{([\s\S]*)\}/.exec(names);
    const url = new URL(from, pathToFileURL(file)).href;
    imports[url] = { names: [...new Set([...(imports[url]?.names ?? []), ...(named ? named[1].split(",").map((n) => n.trim()).filter(Boolean) : [])])] };
  }
}

const hooks = `
const imports = ${JSON.stringify(imports)};
export async function load(url, context, next) {
  const stub = imports[url];
  if (!stub) return next(url, context);
  const lines = stub.names.map((n) => "export const " + n + " = (...a) => globalThis.stubs[" + JSON.stringify(n) + "]?.(...a);");
  lines.push("export default globalThis.defaults[" + JSON.stringify(url.split("/").pop()) + "] ?? globalThis.deep;");
  return { format: "module", source: lines.join("\\n"), shortCircuit: true };
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const timers = [];
const sent = [];
const warnings = [];
let listener;

class FakeXHR {
  open(method, url) {
    this.url = url;
  }
  send() {
    sent.push(this);
  }
  abort() {
    this.aborted = true;
  }
}

const userSettings = {
  clickingAds: true,
  clickingExceptions: "",
  clickOnlyWhenIdleFor: 0,
  clickProbability: 1,
  parseTextAds: true,
  admap: {},
};
const ad = (id, extra = {}) => ({
  id,
  attempts: 0,
  visitedTs: 0,
  pageUrl: "https://news.example.org/",
  contentType: "img",
  contentData: {},
  targetUrl: `https://ads${id}.example.com/click`,
  ...extra,
});
const [page, first, second] = ["a", "b", "c"].map((c) => c.repeat(32));
const admap = { [page]: { [first]: ad(1), [second]: ad(2, { private: true }) } };

const manifest = JSON.parse(readFileSync(`${ext}/manifest.json`, "utf8"));
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === "getManifest" ? () => manifest : k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : typeof k === "symbol" ? undefined : deep),
  apply: () => deep,
  construct: () => deep,
});

Object.assign(globalThis, {
  self: globalThis,
  ardiaPublicTabs: new Set([7]),
  deep,
  XMLHttpRequest: FakeXHR,
  YaMD5: { hashStr: (s) => s },
  browser: { runtime: { getManifest: () => ({}) } },
  setTimeout: (fn) => timers.push(fn),
  vAPI: {
    app: { version: "3.29.2.1" },
    storage: { get: async (key) => (key === "admap" ? { admap } : { ...userSettings }), set() {} },
    messaging: { listen: (l) => (listener = l.listener), UNHANDLED: {} },
    webextFlavor: { soup: new Set(["chromium"]) },
    getURL: (path = "") => `chrome-extension://kmggppiioddbnikpjfodfabgmboeihij/${path}`,
    defer: deep,
  },
  stubs: {
    warn: (...a) => warnings.push(a.join(" ")),
    isValidDomain: () => true,
    type: (v) => typeof v,
    domainFromHostname: (h) => h.split(".").slice(-2).join("."),
    hostnameFromURI: (u) => new URL(u).hostname,
    computeHash: (a) => a.targetUrl,
    unescapeHTML: (s) => s,
  },
  defaults: {
    "background.js": {
      userSettings,
      getNetFilteringSwitch: () => true,
      hiddenSettings: { internalLinkDomains: [] },
      pageStoreFromTabId: () => null,
      changeUserSettings: (key, value) => { userSettings[key] = value; },
    },
    "dnt.js": { mustNotVisit: () => false },
    "webext.js": new Proxy(
      { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} } } },
      { get: (t, k) => (k in t ? t[k] : deep) },
    ),
  },
});

const { default: adnauseam } = await import(pathToFileURL(core).href);
await new Promise((r) => setImmediate(r));
const pollQueue = timers.shift();
const settle = () => new Promise((r) => setImmediate(r));
const poll = async () => {
  timers.length = 0;
  pollQueue();
  await settle();
};
const reset = () => {
  sent.length = 0;
  Object.assign(admap[page][first], { attempts: 0, visitedTs: 0, attemptedTs: 0 });
  globalThis.ardiaStopClicks();
};

test("clicking stays off until Ardia's consent, even with clickingAds on (an import or the extension's own settings)", async () => {
  reset();
  assert.equal(globalThis.ardiaClickConsent, false);
  await poll();
  assert.equal(sent.length, 0);
  globalThis.ardiaClickConsent = true;
  await poll();
  assert.deepEqual(sent.map((x) => x.url), ["https://ads1.example.com/click"]);
});

test("consent without clickingAds clicks nothing, so a click-inclusions list can't turn clicking on", async () => {
  reset();
  globalThis.ardiaClickConsent = true;
  Object.assign(userSettings, { clickingAds: false, clickingExceptions: "example.com" });
  try {
    await poll();
    assert.equal(sent.length, 0);
  } finally {
    Object.assign(userSettings, { clickingAds: true, clickingExceptions: "" });
  }
});

test("revoking while the target is being verified sends nothing, also when consent comes back before it resolves", async () => {
  for (const regrant of [false, true]) {
    reset();
    globalThis.ardiaClickConsent = true;
    timers.length = 0;
    pollQueue();
    globalThis.ardiaClickConsent = false;
    globalThis.ardiaStopClicks();
    if (regrant) globalThis.ardiaClickConsent = true;
    await settle();
    assert.equal(sent.length, 0, regrant ? "re-granted" : "revoked");
  }
});

test("revoking aborts the visit in flight", async () => {
  reset();
  globalThis.ardiaClickConsent = true;
  await poll();
  assert.equal(sent.length, 1);
  globalThis.ardiaClickConsent = false;
  globalThis.ardiaStopClicks();
  assert.equal(sent[0].aborted, true);
  assert.equal(sent[0].onload, null);
});

test("ads from private windows are never visited, and never registered", async () => {
  reset();
  globalThis.ardiaClickConsent = true;
  admap[page][first].visitedTs = 1;
  await poll();
  assert.equal(sent.length, 0, "the stored private ad");

  const background = defaults["background.js"];
  const oldPageStore = background.pageStoreFromTabId;
  const pageUrl = "https://news.example.org/registration-test";
  background.pageStoreFromTabId = () => ({ rawURL: pageUrl, title: "Test page", tabHostname: "news.example.org", getNetFilteringSwitch: () => true });
  const register = (id, sender, extra = {}) => listener({ what: "registerAd", ad: ad(id, {
    contentData: { src: "https://ads.example.com/banner.png" }, ...extra,
  }) }, sender, () => {});
  try {
    register(3, { tabId: 7, ardiaIncognito: true });
    register(4, { tabId: 7 }, { private: true });
    register(5, { tabId: 7 });
    const targets = adnauseam.adlist().map(a => a.targetUrl);
    assert.ok(!targets.includes(ad(3).targetUrl), "a private tab's ad is not stored");
    assert.ok(!targets.includes(ad(4).targetUrl), "an ad marked private is not stored");
    assert.ok(targets.includes(ad(5).targetUrl), "a normal tab's ad is stored");
  } finally {
    background.pageStoreFromTabId = oldPageStore;
    delete admap[pageUrl];
  }
});

test("Ardia's revoke stops the real switch while a target is being verified, and a stale grant can't reopen it", async () => {
  reset();
  globalThis.ardiaClickConsent = true;
  let resolved;
  browser.dns = { resolve: () => new Promise((r) => (resolved = r)) };
  try {
    timers.length = 0;
    pollQueue();
    await settle();
    assert.ok(resolved, "the target is being verified");
    assert.deepEqual(await runOnPage(revoke(1), { background: globalThis }), { value: null });
    resolved({ addresses: ["93.184.216.34"] });
    await settle();
    assert.equal(sent.length, 0);
  } finally {
    delete browser.dns;
  }
  globalThis.µBlock = { isReadyPromise: Promise.resolve() };
  const dashboard = (m) => Promise.resolve(m.what === "getWhitelist" ? { whitelist: [] } : {});
  await runOnPage(grant(true, 0), { background: globalThis, send: dashboard });
  await poll();
  assert.equal(sent.length, 0, "stale grant");
  await runOnPage(grant(true, 2), { background: globalThis, send: dashboard });
  await poll();
  assert.equal(sent.length, 1, "a grant after the revoke");
  await runOnPage(revoke(1), { background: globalThis });
  assert.equal(sent[0].aborted, undefined, "an older revoke");
  await runOnPage(revoke(3), { background: globalThis });
  assert.equal(sent[0].aborted, true);
});

test("a private tab is recognized from the browser's own tab, through AdNauseam's messaging", async () => {
  const contentListener = listener;
  const originalRegister = adnauseam.registerAd;
  let registrations = 0;
  adnauseam.registerAd = () => { registrations++; };
  Object.assign(globalThis, { browser: deep, Image: function () { return deep; }, document: deep, window: deep });
  await import(pathToFileURL(vapiBackground).href);
  vAPI.messaging.listen({ name: "adnauseam", listener: contentListener });
  const register = (name, incognito, extra = {}) => {
    const port = {
      name,
      sender: { origin: "https://news.example.org", url: "https://news.example.org/", frameId: 0, tab: { id: 7, url: "https://news.example.org/", incognito } },
      onDisconnect: { addListener() {} },
      onMessage: { addListener() {} },
      postMessage() {},
    };
    vAPI.messaging.onPortConnect(port);
    registrations = 0;
    vAPI.messaging.onPortMessage({ channel: "adnauseam", msgId: 1, msg: { what: "registerAd", ad: ad(9, extra) } }, port);
    return registrations === 1;
  };
  assert.equal(register("private", true), false, "a private tab, even when the page doesn't mark the ad");
  assert.equal(register("normal", false), true, "a normal tab reaches registerAd");
  adnauseam.registerAd = originalRegister;
});
