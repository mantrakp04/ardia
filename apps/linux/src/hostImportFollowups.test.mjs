import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_IDLE_MS, UNLOCK_DEADLINE_MS, UNLOCK_LIFETIME_MS, createHostImport } from "./hostImport.ts";
import { randomBytes } from "node:crypto";

class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TOKEN = randomBytes(16).toString("hex");

function fixture(replies = {}) {
  const listeners = new Set();
  const calls = [];
  const timers = [];
  const host = {
    bootstrap: { windowId: "import", profileId: "default", capabilities: [] },
    call: async () => "null",
    invoke: async (method, { args }) => {
      calls.push({ method, args });
      const reply = replies[method];
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(args) : reply ?? true;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let now = 1_000_000;
  const clock = {
    now: () => now,
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => { timer.live = false; },
  };
  const emit = (payload) => { for (const listener of [...listeners]) listener("ArdiaImport", "onImportEvent", payload); };
  const fire = (ms) => {
    for (const timer of timers.filter((t) => t.live && t.ms === ms)) {
      timer.live = false;
      timer.run();
    }
  };
  const advance = (ms) => { now += ms; };
  return { api: createHostImport(host, ImportError, clock), calls, emit, fire, listeners, advance };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const SOURCES = [
  { id: "chrome", name: "Google Chrome", family: "chromium", needsKeychain: true, keychainService: "Chrome Safe Storage", profiles: [] },
  { id: "brave", name: "Brave", family: "chromium", needsKeychain: false, profiles: [] },
  { id: "firefox", name: "Firefox", family: "firefox", needsKeychain: false, profiles: [] },
];

test("a keyring-protected browser stays locked until the native unlock reports success", async () => {
  const { api, calls, emit, listeners } = fixture({ "ArdiaImport.listBrowsers": SOURCES });
  const sources = await api.listBrowsers();
  assert.equal(sources[0].needsKeychain, true);
  assert.equal(api.isBrowserUnlocked("chrome"), false);
  assert.equal(api.isBrowserUnlocked("brave"), true);
  assert.equal(api.isBrowserUnlocked("firefox"), false);
  await api.unlockBrowser("brave");
  assert.deepEqual(calls.map((c) => c.method), ["ArdiaImport.listBrowsers"]);

  const unlocking = api.unlockBrowser("chrome");
  await settle();
  const [requestId, browserId, password] = calls.at(-1).args;
  assert.equal(calls.at(-1).method, "ArdiaImport.unlockBrowser");
  assert.deepEqual([browserId, password], ["chrome", null]);
  emit({ jobId: "other", type: "unlocked" });
  emit({ jobId: requestId, type: "unlocked" });
  await unlocking;
  assert.equal(api.isBrowserUnlocked("chrome"), true);
  assert.equal(listeners.size, 0);

  api.forgetUnlockedKeys();
  assert.equal(api.isBrowserUnlocked("chrome"), false);
  await settle();
  assert.equal(calls.at(-1).method, "ArdiaImport.forgetUnlockedKeys");
});

test("a locked, denied or stalled keyring rejects with its code and leaves the browser locked", async () => {
  const { api, calls, emit, fire } = fixture({ "ArdiaImport.listBrowsers": SOURCES });
  await api.listBrowsers();
  for (const code of ["locked", "denied", "notFound", "unavailable"]) {
    const attempt = api.unlockBrowser("chrome");
    await settle();
    emit({ jobId: calls.at(-1).args[0], type: "failed", code, message: `keyring ${code}` });
    await assert.rejects(attempt, { code });
    assert.equal(api.isBrowserUnlocked("chrome"), false);
  }
  const stalled = api.unlockBrowser("chrome");
  await settle();
  fire(UNLOCK_DEADLINE_MS);
  await assert.rejects(stalled, { code: "timeout" });
  assert.ok(UNLOCK_DEADLINE_MS > 120_000);
  const refused = fixture({ "ArdiaImport.listBrowsers": SOURCES, "ArdiaImport.unlockBrowser": Object.assign(new Error("busy"), { code: "busy" }) });
  await refused.api.listBrowsers();
  await assert.rejects(refused.api.unlockBrowser("chrome"), { code: "busy" });
});

test("Firefox passes its primary password to the native unlock and only then counts as unlocked", async () => {
  const { api, calls, emit } = fixture({ "ArdiaImport.listBrowsers": SOURCES });
  await api.listBrowsers();
  const unlocking = api.unlockBrowser("firefox", { primaryPassword: "primary pw" });
  await settle();
  assert.deepEqual(calls.at(-1).args.slice(1), ["firefox", "primary pw", [], []]);
  emit({ jobId: calls.at(-1).args[0], type: "unlocked" });
  await unlocking;
  assert.equal(api.isBrowserUnlocked("firefox"), true);
});

test("imported cookies, addresses and cards are written natively from a vault token and finish by event", async () => {
  const { api, calls, emit, fire, listeners } = fixture();
  const writing = api.writeImported(TOKEN, "work", ["cookies", "autofill"]);
  await settle();
  const [requestId, token, profile, kinds] = calls.at(-1).args;
  assert.equal(calls.at(-1).method, "ArdiaImport.writeImported");
  assert.deepEqual([token, profile, kinds], [TOKEN, "work", ["cookies", "autofill"]]);
  emit({ jobId: requestId, type: "progress", kind: "cookies", phase: "progress", processed: 500, total: 900 });
  emit({ jobId: requestId, type: "importedWritten", cookies: 880, cookiesRejected: 20, cookiesExisting: 3, addresses: 2, cards: 1, autofillFailed: 1 });
  assert.deepEqual(await writing, { cookies: 880, cookiesRejected: 20, cookiesExisting: 3, addresses: 2, cards: 1, autofillFailed: 1 });
  assert.equal(listeners.size, 0);

  const failing = api.writeImported(TOKEN, "", ["cookies"]);
  await settle();
  emit({ jobId: calls.at(-1).args[0], type: "failed", code: "ERR_PROFILE_DELETED", message: "gone" });
  await assert.rejects(failing, { code: "ERR_PROFILE_DELETED" });
  const stalled = api.writeImported(TOKEN, "", ["cookies"]);
  await settle();
  fire(IMPORT_IDLE_MS);
  await assert.rejects(stalled, { code: "timeout" });
  const refused = fixture({ "ArdiaImport.writeImported": Object.assign(new Error("expired"), { code: "expired" }) });
  await assert.rejects(refused.api.writeImported(TOKEN, "", ["cookies"]), { code: "expired" });
  await assert.rejects(api.writeImported("not-a-token", "", ["cookies"]), { code: "expired" });

  api.discardImported(TOKEN);
  await settle();
  assert.deepEqual(calls.at(-1), { method: "ArdiaImport.discardImported", args: [TOKEN] });
});

test("an import result keeps a well-formed vault token and the native counts", async () => {
  const { api, calls, emit } = fixture();
  const running = api.importData("chrome", "Default", ["cookies", "autofill", "tabs"]);
  await settle();
  const jobId = calls[0].args[0];
  emit({ jobId, type: "done", result: {
    browserId: "chrome", profileId: "Default", history: [], historyCount: 0, credentials: [],
    tabs: [{ url: "https://a.example/", title: "A", pinned: false, windowIndex: 0, active: true }],
    tabGroups: [{ id: "g", title: "G", color: "blue", collapsed: false }],
    cookieCount: 12, addressCount: 2, cardCount: 1, vaultToken: TOKEN, failed: [], warnings: [],
  } });
  const result = await running;
  assert.equal(result.vaultToken, TOKEN);
  assert.deepEqual([result.cookieCount, result.addressCount, result.cardCount], [12, 2, 1]);
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabGroups.length, 1);
  const second = api.importData("chrome", "Default", ["cookies"]);
  await settle();
  emit({ jobId: calls.at(-1).args[0], type: "done", result: { cookieCount: -4, vaultToken: TOKEN.toUpperCase() } });
  const bad = await second;
  assert.equal(bad.vaultToken, undefined);
  assert.equal(bad.cookieCount, 0);
});

test("an unlock expires with the native key's ten-minute lifetime", async () => {
  const { api, calls, emit, advance } = fixture({ "ArdiaImport.listBrowsers": SOURCES });
  await api.listBrowsers();
  const unlocking = api.unlockBrowser("chrome");
  await settle();
  emit({ jobId: calls.at(-1).args[0], type: "unlocked" });
  await unlocking;
  assert.equal(UNLOCK_LIFETIME_MS, 10 * 60_000);
  advance(UNLOCK_LIFETIME_MS - 1000);
  assert.equal(api.isBrowserUnlocked("chrome"), true);
  advance(1000);
  assert.equal(api.isBrowserUnlocked("chrome"), false);
  assert.equal(api.isBrowserUnlocked("brave"), true);
});

test("an import result keeps only well-formed PNG favicons for http and https pages", async () => {
  const { api, calls, emit } = fixture();
  const running = api.importData("firefox", "a.default", ["bookmarks"]);
  await settle();
  const png = "iVBORw0KGgoAAAANSUhEUg==";
  emit({ jobId: calls[0].args[0], type: "done", result: { favicons: [
    { page: "https://a.example/", icon: "https://a.example/favicon.ico", png },
    { page: "javascript:alert(1)", icon: "https://b.example/i.png", png },
    { page: "https://c.example/", icon: "https://c.example/i.png", png: "R0lGODlh" },
    { page: "https://d.example/", icon: 4, png },
    { page: "https://e.example/", icon: "https://e.example/i.png", png: "iVBORw0KGgo!!" },
    "nope",
  ] } });
  const result = await running;
  assert.deepEqual(result.favicons, [{ page: "https://a.example/", icon: "https://a.example/favicon.ico", png }]);
});

test("a Firefox unlock whose card key the keyring refused leaves the browser locked, so the next import asks again", async () => {
  const { api, calls, emit } = fixture({ "ArdiaImport.listBrowsers": SOURCES });
  await api.listBrowsers();
  const unlocking = api.unlockBrowser("firefox", { primaryPassword: "primary pw", profiles: ["a.default", 4], kinds: ["passwords", "autofill"] });
  await settle();
  assert.deepEqual(calls.at(-1).args.slice(1), ["firefox", "primary pw", ["a.default"], ["passwords", "autofill"]]);
  emit({ jobId: calls.at(-1).args[0], type: "unlocked", cardsLocked: true });
  await unlocking;
  assert.equal(api.isBrowserUnlocked("firefox"), false);
  const again = api.unlockBrowser("firefox", { primaryPassword: "primary pw", profiles: ["a.default"], kinds: ["autofill"] });
  await settle();
  emit({ jobId: calls.at(-1).args[0], type: "unlocked", cardsLocked: false });
  await again;
  assert.equal(api.isBrowserUnlocked("firefox"), true);
});
