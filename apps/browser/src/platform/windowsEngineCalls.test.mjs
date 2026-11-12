import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { domainCall, domainFunctions, domainsOf, reproduced, topicRouter } from "../../../../packages/expo-windows/src/engine/domains/tables.ts";
import { watchDownloads } from "../../../../packages/expo-windows/src/engine/domains/downloads.ts";

const repo = new URL("../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");
const ios = "packages/ardiacore/ios/";
const windowsDomains = "packages/expo-windows/src/engine/domains/";
const engineSources = "engine/chromium/src/chrome/browser/ardia/";
const rows = JSON.parse(read(`${windowsDomains}forwarded.json`));
const MAC_ONLY = new Set(["swipe", "webKit"]);
const sorted = (list) => [...list].sort();

function macTables() {
  const tables = {};
  for (const file of readdirSync(new URL(ios, repo)).filter((name) => name.endsWith("Module.swift"))) {
    const text = read(ios + file);
    const domain = text.match(/CallTable\(domain: "([a-zA-Z]+)"/)?.[1];
    if (!domain || MAC_ONLY.has(domain)) continue;
    const table = (tables[domain] = { verbs: [], passing: {} });
    for (const [, verb, passing] of text.matchAll(/^ {4}"([a-zA-Z]+)": (?:EngineCall\.passing\("(ac_[a-z_]+)"\),?$)?/gm)) {
      table.verbs.push(verb);
      if (passing) table.passing[verb] = passing;
    }
  }
  return tables;
}

function fakeEngine(reply = () => "{}") {
  const engine = {
    calls: [],
    events: [],
    missed: [],
    call: async (name, profile, argsJson) => {
      engine.calls.push({ name, profile, args: JSON.parse(argsJson) });
      return reply(name, profile, JSON.parse(argsJson));
    },
    emit: (name, data) => engine.events.push({ name, data }),
    missing: async (domain, verb) => {
      engine.missed.push(`${domain}.${verb}`);
      return "null";
    },
  };
  return engine;
}

const calling = (engine, domain) => {
  const call = domainCall(rows, engine, domain);
  return async (verb, args = {}, profile = "") => JSON.parse(await call(verb, profile, JSON.stringify(args)));
};

const mac = macTables();

test("the scan finds the Mac's call tables", () => {
  assert.equal(Object.keys(mac).length, 17);
  assert.ok(Object.values(mac).flatMap((table) => Object.keys(table.passing)).length >= 19);
});

test("every verb the Mac passes straight to the engine goes to the same engine call on Windows", () => {
  const passing = Object.fromEntries(Object.entries(mac).filter(([, table]) => Object.keys(table.passing).length).map(([domain, table]) => [domain, table.passing]));
  assert.deepEqual(rows.forwarded, passing);
});

test("every verb of the Mac's tables is forwarded, reproduced or listed as missing on Windows, and nothing else is", () => {
  assert.deepEqual(domainsOf(rows), sorted(Object.keys(mac)));
  for (const [domain, table] of Object.entries(mac)) {
    const kinds = [Object.keys(rows.forwarded[domain] ?? {}), Object.keys(reproduced[domain] ?? {}), rows.missing[domain] ?? []];
    const onWindows = kinds.flat();
    assert.deepEqual(sorted(onWindows), sorted(table.verbs), `${domain} has the Mac's verbs`);
    assert.equal(new Set(onWindows).size, onWindows.length, `${domain} answers each verb one way`);
  }
});

test("Windows only names engine calls the Windows engine has", () => {
  const built = new Set(
    readdirSync(new URL(engineSources, repo))
      .filter((name) => name.endsWith(".cc"))
      .flatMap((name) => [...read(engineSources + name).matchAll(/^AC_(?:PROFILE|ARGS)_CALL\((ac_[a-z_]+)/gm)].map((match) => match[1])),
  );
  const named = new Set(Object.values(rows.forwarded).flatMap((table) => Object.values(table)));
  for (const name of readdirSync(new URL(windowsDomains, repo)).filter((file) => file.endsWith(".ts")))
    for (const [, call] of read(windowsDomains + name).matchAll(/"(ac_[a-z_]+)"/g)) named.add(call);
  assert.ok(named.size > 40, "the scan found the calls");
  assert.deepEqual(sorted(named).filter((name) => !built.has(name)), []);
});

test("the forwarded topics and their event names are the Mac's", () => {
  const bridge = read(`${ios}ArdiaEngineBridge.mm`);
  const between = (from, to) => bridge.slice(bridge.indexOf(from), bridge.indexOf(to, bridge.indexOf(from)));
  const renamed = new Map([...between("NSString *AppEventOfTopic(", "\n}").matchAll(/isEqualToString:@"([^"]+)"\] \? @"([^"]+)"/g)].map((match) => [match[1], match[2]]));
  const topics = Object.fromEntries([...between("ForwardedTopics()", "];").matchAll(/@"([^"]+)"/g)].map((match) => [match[1], renamed.get(match[1]) ?? match[1]]));
  assert.deepEqual(rows.topics, topics);
});

test("a forwarded verb sends the profile and arguments unchanged and returns the engine's reply", async () => {
  const engine = fakeEngine(() => '{"entries":[1]}');
  const reply = await domainCall(rows, engine, "history")("query", "incognito1@work", '{"maxUrls":5}');
  assert.equal(reply, '{"entries":[1]}');
  assert.deepEqual(engine.calls, [{ name: "ac_history_query", profile: "incognito1@work", args: { maxUrls: 5 } }]);
});

test("errors carry the Mac's codes", async () => {
  const failing = fakeEngine(() => '{"error":"profile not loaded"}');
  await assert.rejects(calling(failing, "history")("query"), { code: "ERR_ENGINE", message: "profile not loaded" });
  await assert.rejects(calling(failing, "passwords")("list"), { code: "ERR_ENGINE", message: "profile not loaded" });
  const engine = fakeEngine();
  await assert.rejects(calling(engine, "history")("nope"), { code: "ERR_UNKNOWN_CALL", message: "history.nope isn't a call" });
  await assert.rejects(calling(engine, "history")("toString"), { code: "ERR_UNKNOWN_CALL" });
  await assert.rejects(domainCall(rows, engine, "history")("query", "", "[]"), { code: "ERR_BAD_ARGS", message: "history.query: the arguments aren't a JSON object" });
  await assert.rejects(calling(engine, "passwords")("reveal", { origin: "https://a.example" }), { code: "ERR_BAD_ARGS", message: "passwords.reveal: username is missing" });
  await assert.rejects(calling(engine, "sites")("settings", { origin: "https://a.example", engine: "gecko" }), { code: "ERR_BAD_ARGS" });
  assert.deepEqual(engine.calls, []);
});

test("a verb Windows has no native code for goes to the stand-in", async () => {
  const engine = fakeEngine();
  assert.equal(await calling(engine, "tabs")("strips"), null);
  assert.equal(await calling(engine, "sites")("settings", { origin: "https://a.example", engine: "webkit" }), null);
  assert.equal(await calling(engine, "engine")("setCliActiveTab", { tabId: "t1" }), null);
  assert.deepEqual(engine.missed, ["tabs.strips", "sites.settings", "engine.setCliActiveTab"]);
  assert.deepEqual(engine.calls, []);
});

test("passwords are asked of the original profile by origin, and listed with dates", async () => {
  const engine = fakeEngine((name) => (name === "ac_passwords_list" ? '{"passwords":[{"origin":"https://a.example","username":"u"}]}' : '{"ok":true}'));
  const passwords = calling(engine, "passwords");
  assert.deepEqual(await passwords("list", {}, "incognito1@work"), { passwords: [{ origin: "https://a.example", username: "u", created: 0, modified: 0 }] });
  assert.deepEqual(await passwords("remove", { origin: "HTTPS://A.example:443/login?x", username: "u" }), { ok: true });
  assert.deepEqual(await passwords("allowSaving", { origin: "android://hash@com.example/" }), { ok: true });
  const { save, update } = domainFunctions(engine).passwords;
  assert.deepEqual(JSON.parse(await save("work", "http://a.example:8080/x", "u", "secret")), { ok: true });
  assert.deepEqual(JSON.parse(await update("", "https://a.example", "u", null, "next")), { ok: true });
  assert.deepEqual(engine.calls, [
    { name: "ac_passwords_list", profile: "work", args: {} },
    { name: "ac_passwords_remove", profile: "", args: { origin: "https://a.example", username: "u" } },
    { name: "ac_passwords_allow", profile: "", args: { origin: "android://hash@com.example/" } },
    { name: "ac_passwords_add", profile: "work", args: { origin: "http://a.example:8080", username: "u", password: "secret" } },
    { name: "ac_passwords_update", profile: "", args: { origin: "https://a.example", username: "u", newPassword: "next" } },
  ]);
});

test("autofill entries are dated, and a card is saved with its number only when one is given", async () => {
  const engine = fakeEngine((name) => (name === "ac_autofill_cards" ? '{"cards":[{"id":"c1","last4":"4242"}]}' : name === "ac_autofill_card_number" ? '{"number":null}' : '{"id":"c1"}'));
  const autofill = calling(engine, "autofill");
  assert.deepEqual(await autofill("cards"), { cards: [{ id: "c1", last4: "4242", created: 0, modified: 0 }] });
  assert.deepEqual(await autofill("cardNumber", { id: "c1" }), {});
  assert.deepEqual(await autofill("saveAddress", { address: { name: "Ada", postalCode: 1234, skipped: [] } }), { id: "c1" });
  const { saveCard } = domainFunctions(engine).autofill;
  await saveCard("", { name: "Ada" }, null);
  await saveCard("", { name: "Ada" }, "4242 4242");
  assert.deepEqual(engine.calls.slice(2), [
    { name: "ac_autofill_save_address", profile: "", args: { address: { name: "Ada", postalCode: "1234" } } },
    { name: "ac_autofill_save_card", profile: "", args: { card: { name: "Ada" } } },
    { name: "ac_autofill_save_card", profile: "", args: { card: { name: "Ada" }, number: "4242 4242" } },
  ]);
});

test("site settings and zoom use the profile as given, and zoom is a factor in the app and a level in the engine", async () => {
  const engine = fakeEngine((name) => (name === "ac_zoom_list" ? '{"levels":{"a.example":1,"b.example":-2}}' : name === "ac_site_settings_get" ? '{"settings":{"popups":{"value":"ask","isDefault":true}}}' : '{"ok":true}'));
  const sites = calling(engine, "sites");
  assert.deepEqual(await sites("zoomLevels", {}, "work"), { "a.example": 1.2, "b.example": 0.69 });
  assert.deepEqual(await sites("zoomLevels", {}, "incognito1@work"), {});
  assert.deepEqual(await sites("settings", { origin: "https://a.example", engine: "chromium" }, "incognito1@work"), { popups: { value: "ask", isDefault: true } });
  assert.equal(await sites("setZoom", { host: "A.example", zoom: 1.44 }, "work"), null);
  assert.equal(await sites("setZoom", { host: "a.example", zoom: 1 }, "work"), null);
  assert.equal(await sites("setZoom", { host: "a.example", zoom: 0 }, "work"), null);
  assert.equal(engine.calls.length, 4);
  assert.deepEqual(engine.calls[1], { name: "ac_site_settings_get", profile: "incognito1@work", args: { origin: "https://a.example" } });
  assert.equal(engine.calls[2].args.host, "a.example");
  assert.ok(Math.abs(engine.calls[2].args.level - 2) < 1e-9);
  assert.deepEqual(engine.calls[3], { name: "ac_zoom_set", profile: "work", args: { host: "a.example", level: 0 } });
});

test("extensions are listed in the app's shape, and a change is announced once the engine made it", async () => {
  const list = { extensions: [{ id: "abc", location: "FROM_STORE", optionsUrl: null, path: "C:\\ext" }, { id: "def", location: "UNPACKED" }] };
  const engine = fakeEngine((name) => (name === "ac_extensions_list" ? JSON.stringify(list) : name === "ac_extensions_reload" ? '{"error":"No such extension"}' : '{"ok":true,"id":"abc"}'));
  const extensions = calling(engine, "extensions");
  assert.deepEqual(await extensions("list"), {
    extensions: [
      { id: "abc", location: "FROM_STORE", path: "C:\\ext", incognitoSplit: false, siteAccess: null, optionsUrl: null, homepageUrl: null, fromWebStore: true, webStoreUrl: "https://chromewebstore.google.com/detail/abc" },
      { id: "def", location: "UNPACKED", incognitoSplit: false, siteAccess: null, optionsUrl: null, path: null, homepageUrl: null, fromWebStore: false, webStoreUrl: null },
    ],
  });
  await extensions("setEnabled", { id: "abc", enabled: false }, "incognito1@work");
  await extensions("configure", { id: "abc", options: { pinned: true, unknown: 1 } });
  await extensions("install", { path: "/ext" });
  await assert.rejects(extensions("reload", { id: "abc" }), { code: "ERR_ENGINE" });
  assert.deepEqual(engine.calls[2], { name: "ac_extensions_configure", profile: "", args: { id: "abc", pinned: true } });
  assert.deepEqual(engine.events, [
    { name: "extensions.changed", data: { profile: "work", id: "abc", event: "disabled" } },
    { name: "extensions.changed", data: { profile: "", id: "abc", event: "configured" } },
    { name: "extensions.changed", data: { profile: "", id: "abc", event: "installed" } },
  ]);
});

test("engine topics reach the app under the Mac's event names, with a burst of the same event sent once", () => {
  const engine = fakeEngine();
  const queued = [];
  const route = topicRouter(rows.topics, engine, (run) => queued.push(run));
  route({ topic: "bookmarks.changed", payload: { profile: "work" } });
  route({ topic: "bookmarks.changed", payload: { profile: "work" } });
  route({ topic: "cliControl", payload: { state: "off" } });
  route({ topic: "bookmarks.changed", payload: { profile: "work" } });
  route({ topic: "tabs.strip", payload: { window: 1 } });
  route({ topic: "downloads.removed", payload: { id: "d1" } });
  assert.deepEqual(engine.events, []);
  assert.equal(queued.length, 1);
  queued.shift()();
  assert.deepEqual(engine.events, [
    { name: "bookmarks.changed", data: { profile: "work" } },
    { name: "engine.cliControl", data: { state: "off" } },
    { name: "bookmarks.changed", data: { profile: "work" } },
  ]);
  route({ topic: "history.changed", payload: { profile: "" } });
  assert.equal(queued.length, 1);
});

test("a download carries its profile, and its commands go to that profile", async () => {
  const engine = fakeEngine((name) => (name === "ac_downloads_list" ? '{"downloads":[{"id":"d2","state":"finished"}]}' : '{"ok":true}'));
  const route = topicRouter(rows.topics, engine, () => assert.fail("downloads aren't held back"));
  route({ topic: "downloads.changed", payload: { profile: "work", offTheRecord: true, download: { id: "d1", state: "downloading" } } });
  route({ topic: "downloads.changed", payload: { profile: "work" } });
  await watchDownloads(engine, "play");
  assert.deepEqual(engine.events, [
    { name: "downloads.changed", data: { id: "d1", state: "downloading", profile: "work" } },
    { name: "downloads.changed", data: { id: "d2", state: "finished", profile: "play" } },
  ]);
  const downloads = calling(engine, "downloads");
  assert.equal(await downloads("pause", { id: "d1" }), null);
  assert.equal(await downloads("cancel", { id: "d2" }), null);
  assert.equal(await downloads("keep", { id: "unknown" }), null);
  assert.deepEqual(engine.calls.slice(1), [
    { name: "ac_downloads_command", profile: "work", args: { id: "d1", command: "pause" } },
    { name: "ac_downloads_command", profile: "play", args: { id: "d2", command: "cancel" } },
    { name: "ac_downloads_command", profile: "", args: { id: "unknown", command: "keep" } },
  ]);
});

test("the engine domain shapes what the Mac shapes", async () => {
  const engine = fakeEngine((name) => (name === "ac_tasks_list" ? '{"tasks":[{"id":1,"tabIds":[7]}]}' : name === "ac_components_list" ? '{"components":[{"id":"w"}]}' : name === "ac_search_engines_list" ? '{"engines":[{"name":"g"}]}' : '{"valid":true}'));
  const engineDomain = calling(engine, "engine");
  assert.deepEqual(await engineDomain("tasks"), [{ id: 1, tabIds: [] }]);
  assert.deepEqual(await engineDomain("components"), [{ id: "w" }]);
  assert.deepEqual(await engineDomain("validateKeepActiveSite", { site: "a.example" }), { valid: true });
  await engineDomain("setCliControl", { on: true });
  await engineDomain("setCliActiveTab", { tabId: null });
  assert.deepEqual(await calling(engine, "search")("engines", {}, "incognito1@work"), { list: { engines: [{ name: "g" }] } });
  assert.deepEqual(engine.calls.slice(2), [
    { name: "ac_memory_saver", profile: "", args: { validate: "a.example" } },
    { name: "ac_cli_control", profile: "", args: { on: true } },
    { name: "ac_cli_control", profile: "", args: { active: -1 } },
    { name: "ac_search_engines_list", profile: "work", args: {} },
  ]);
});

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function hostedEngine(removal, reply) {
  const engine = fakeEngine(reply);
  engine.hosted = [];
  engine.removed = [];
  engine.host = async (verb) => {
    engine.hosted.push(verb);
    return { chromium: "157.0.1.2", userDataDir: "C:\\Ardia\\User Data" };
  };
  engine.removeProfileFolder = async (root, folder) => {
    engine.removed.push([root, folder]);
    return removal;
  };
  return engine;
}

test("deleting a profile's data removes its folder, or clears its data and waits while the engine holds it", async () => {
  const gone = hostedEngine("removed");
  assert.deepEqual(await calling(gone, "profiles")("deleteData", {}, "work.1"), { remaining: [] });
  assert.deepEqual(gone.removed, [["C:\\Ardia\\User Data", "Ardia work_1"]]);
  assert.deepEqual(gone.calls, []);

  const absent = hostedEngine("absent");
  assert.deepEqual(await calling(absent, "profiles")("deleteData", {}, "never"), { remaining: [] });

  const held = hostedEngine("inUse", () => '{"ok":true}');
  const { remaining } = await calling(held, "profiles")("deleteData", {}, "work");
  assert.equal(remaining.length, 1);
  assert.deepEqual(held.calls, [{ name: "ac_browsing_data_clear", profile: "work", args: { types: ["history", "siteData", "cache", "downloads", "formData", "siteSettings"], since: 0 } }]);

  const old = hostedEngine("unsupported");
  assert.equal((await calling(old, "profiles")("deleteData", {}, "work")).remaining.length, 1);
  assert.deepEqual(old.calls, []);

  const quiet = hostedEngine("removed");
  assert.deepEqual(await calling(quiet, "profiles")("deleteData", {}, "incognito2@work"), { remaining: [] });
  assert.deepEqual(await calling(quiet, "profiles")("deleteData", {}, ""), { remaining: ["data"] });
  assert.deepEqual(quiet.removed, []);
});

test("engine.info answers from the engine host in the Mac's shape", async () => {
  const engine = hostedEngine("removed");
  assert.deepEqual(await calling(engine, "engine")("info"), {
    pid: 0,
    dataDirectory: "C:\\Ardia\\User Data",
    engine: "ardiacore",
    chromiumVersion: "157.0.1.2",
    liveBrowsers: 0,
    popupWindows: 0,
    chromeWindows: 0,
  });
  assert.deepEqual(engine.hosted, ["host.info"]);
});

test("favicons.fetch answers the icon Chromium stored for that address, with its size", async () => {
  const url = "https://a.example/favicon.ico";
  const engine = fakeEngine(() => JSON.stringify({ pages: {}, icons: { [url]: { png: ONE_PIXEL_PNG } } }));
  const favicons = calling(engine, "favicons");
  assert.deepEqual(await favicons("fetch", { url }, "work"), { uri: `data:image/png;base64,${ONE_PIXEL_PNG}`, width: 1, height: 1 });
  assert.deepEqual(engine.calls, [{ name: "ac_favicons_get", profile: "work", args: { pages: [], icons: [url], size: 64 } }]);
  assert.deepEqual(await favicons("fetch", { url: `data:image/png;base64,${ONE_PIXEL_PNG}` }), { uri: `data:image/png;base64,${ONE_PIXEL_PNG}`, width: 1, height: 1 });
  assert.equal(await favicons("fetch", { url: "data:image/png;base64,bm90IGEgcG5nIGF0IGFsbCwganVzdCB0ZXh0IGhlcmU=" }), null);
  assert.equal(await favicons("fetch", { url: "file:///C:/icon.png" }), null);
  assert.equal(await favicons("fetch", { url }, "incognito1@work"), null);
  assert.equal(engine.calls.length, 1);
});
