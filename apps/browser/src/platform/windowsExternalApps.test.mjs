import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readExternalAppAsk, schemeOf, serializedOrigin, trustworthyOrigin, windowsExternalAppCounts, windowsExternalApps } from "../../../../packages/expo-windows/src/engine/domains/externalApps.ts";
import { answerExternalApp, showExternalApp } from "../state/site/prompts.ts";
import { noteExternalApp, takeExternalAppCounts } from "../state/telemetry/externalAppCounts.ts";

const HANDLERS = { mailto: { name: "Mail", path: "C:\\Mail\\mail.exe", icon: "data:image/png;base64,AA==" }, ardiatest: { name: "Test Handler", path: null, icon: null } };

function fakes() {
  const opened = [];
  const docs = new Map();
  const gone = new Set();
  const native = { describe: async (scheme) => HANDLERS[scheme] ?? null, open: async (url, name) => (opened.push(url), name === HANDLERS[schemeOf(url)]?.name) };
  const documents = { readDocument: (name) => docs.get(name) ?? null, writeDocument: (name, text) => void docs.set(name, text) };
  const stillAsked = async (page, id) => !gone.has(page) && !gone.has(id);
  return { opened, docs, gone, apps: windowsExternalApps(() => native, () => documents, stillAsked), native, documents };
}

const ask = (fields = {}) => ({ id: "x1", url: "mailto:someone@example.com", origin: "https://mail.example", userGesture: true, offTheRecord: false, ...fields });

test("a link with a handler asks with the handler's name and icon, in the Mac's words", async () => {
  const { apps, opened } = fakes();
  const request = await apps.request(ask(), "Ardia p-1", "tab-1");
  assert.match(request?.id ?? "", /^w\d+$/);
  assert.deepEqual({ ...request, id: "x1" }, {
    id: "x1",
    url: "mailto:someone@example.com",
    scheme: "mailto",
    origin: "https://mail.example",
    app: "Mail",
    appPath: "C:\\Mail\\mail.exe",
    icon: "data:image/png;base64,AA==",
    title: "Open “Mail”?",
    message: "https://mail.example wants to open this application.",
    remember: "Always allow https://mail.example to open links of this type in Mail",
  });
  assert.deepEqual(opened, []);
});

test("no opens without a yes, and a no or an unknown id opens nothing", async () => {
  const { apps, opened } = fakes();
  const first = await apps.request(ask(), "Ardia p-1", "tab-1");
  assert.equal(await apps.resolve(first.id, false, false), false);
  assert.equal(await apps.resolve(first.id, true, false), false);
  assert.equal(await apps.resolve("x1", true, false), false);
  assert.equal(await apps.resolve("nope", true, false), false);
  assert.deepEqual(opened, []);
  const second = await apps.request(ask({ id: "x2" }), "Ardia p-1", "tab-1");
  assert.equal(await apps.resolve(second.id, true, false), true);
  assert.deepEqual(opened, ["mailto:someone@example.com"]);
});

test("a remembered site opens the app with a gesture and asks without one; remembering needs a trustworthy origin and no private profile", async () => {
  const { apps, opened, docs } = fakes();
  const first = await apps.request(ask(), "Ardia p-1", "tab-1");
  await apps.resolve(first.id, true, true);
  assert.equal(docs.size, 1);
  windowsExternalAppCounts.takeLaunches();
  assert.equal(await apps.request(ask({ id: "x2" }), "Ardia p-1", "tab-1"), null);
  assert.equal(opened.length, 2);
  assert.deepEqual(windowsExternalAppCounts.takeLaunches(), { opened: 0, refused: 0, automatic: 1 });
  const noGesture = await apps.request(ask({ id: "x3", userGesture: false }), "Ardia p-1", "tab-1");
  assert.equal(noGesture?.app, "Mail");
  assert.equal(opened.length, 2);
  assert.equal((await apps.request(ask({ id: "x4", origin: "http://mail.example" }), "Ardia p-1", "tab-1"))?.remember, null);
  assert.equal((await apps.request(ask({ id: "x5", offTheRecord: true }), "Ardia p-1", "tab-1"))?.remember, null);
  assert.deepEqual(await apps.list("Ardia p-1", "tab-1"), [{ origin: "https://mail.example", scheme: "mailto", app: "Mail", icon: "data:image/png;base64,AA==" }]);
  apps.remove("Ardia p-1", "https://mail.example", "mailto");
  assert.deepEqual(await apps.list("Ardia p-1", "tab-1"), []);
});

test("a scheme with no handler says so and can't be opened", async () => {
  const { apps, opened } = fakes();
  const request = await apps.request(ask({ url: "zoommtg://join?x=1" }), "Ardia p-1", "tab-1");
  assert.equal(request?.app, null);
  assert.equal(request?.message, "Your PC doesn’t have an app for “zoommtg:” links.");
  assert.equal(await apps.resolve(request.id, true, true), false);
  assert.deepEqual(opened, []);
});

test("only a well-formed scheme and a well-formed ask go further", () => {
  assert.equal(schemeOf("MailTo:a@b"), "mailto");
  assert.equal(schemeOf("ms-teams:x"), "ms-teams");
  assert.equal(schemeOf("1abc:x"), null);
  assert.equal(schemeOf("c:\\Windows\\notepad.exe"), null);
  assert.equal(schemeOf("a b:x"), null);
  assert.equal(schemeOf(":x"), null);
  assert.equal(trustworthyOrigin("https://a.example"), true);
  assert.equal(trustworthyOrigin("http://localhost:8080"), true);
  assert.equal(trustworthyOrigin("http://a.example"), false);
  assert.equal(trustworthyOrigin("null"), false);
  assert.equal(trustworthyOrigin("https://evil.example@bank.example"), false);
  assert.equal(trustworthyOrigin("HTTPS://A.EXAMPLE"), false);
  assert.equal(serializedOrigin("https://a.example:8443"), "https://a.example:8443");
  assert.equal(serializedOrigin("https://[::1]:8443"), "https://[::1]:8443");
  assert.equal(serializedOrigin("https://a.example/path"), null);
  assert.equal(serializedOrigin("https://a .example"), null);
  assert.equal(readExternalAppAsk({ id: "x1", url: "mailto:a", origin: "https://evil.example@bank.example" })?.origin, null);
  assert.equal(readExternalAppAsk({ id: "x 1", url: "mailto:a" }), null);
  assert.equal(readExternalAppAsk({ id: "x1", url: `mailto:${"a".repeat(40000)}` }), null);
  assert.equal(readExternalAppAsk({ url: "mailto:a" }), null);
  assert.deepEqual(readExternalAppAsk({ id: "x9", url: "mailto:a", origin: "https://a.example", userGesture: true }), { id: "x9", url: "mailto:a", origin: "https://a.example", userGesture: true, offTheRecord: false });
});

test("app link prompts and answers are counted and reset once taken", () => {
  takeExternalAppCounts();
  noteExternalApp("allowedAlways");
  noteExternalApp("declined");
  assert.deepEqual(takeExternalAppCounts(), {
    external_app_allows: 0,
    external_app_allows_always: 1,
    external_app_declines: 1,
    external_app_launches: 0,
    external_app_launches_refused: 0,
    external_app_launches_automatic: 0,
  });
});

test("an ask the engine no longer holds, or whose page moved on, opens nothing", async () => {
  const { apps, opened, gone } = fakes();
  const first = await apps.request(ask(), "Ardia p-1", "tab-1");
  gone.add("x1");
  assert.equal(await apps.resolve(first.id, true, false), false);
  const second = await apps.request(ask({ id: "x2" }), "Ardia p-1", "tab-1");
  apps.forgetPage("tab-1");
  assert.equal(await apps.resolve(second.id, true, false), false);
  const third = await apps.request(ask({ id: "x3" }), "Ardia p-1", "tab-2");
  apps.forget(third.id);
  assert.equal(await apps.resolve(third.id, true, false), false);
  assert.deepEqual(opened, []);
});

test("a remembered site opens nothing once its page is gone, and deleting a profile forgets its allowances", async () => {
  const { apps, opened, gone } = fakes();
  const mine = await apps.request(ask(), "Ardia p-1", "tab-1");
  await apps.resolve(mine.id, true, true);
  const theirs = await apps.request(ask({ id: "o1" }), "Ardia p-2", "tab-2");
  await apps.resolve(theirs.id, true, true);
  gone.add("tab-1");
  assert.equal(await apps.request(ask({ id: "x2" }), "Ardia p-1", "tab-1"), null);
  assert.equal(opened.length, 2);
  const waiting = await apps.request(ask({ id: "x3", userGesture: false }), "Ardia p-1", "tab-3");
  apps.forgetProfile("Ardia p-1");
  assert.equal(await apps.resolve(waiting.id, true, false), false);
  assert.deepEqual(await apps.list("Ardia p-1"), []);
  assert.equal((await apps.list("Ardia p-2")).length, 1);
  assert.notEqual(await apps.request(ask({ id: "x4" }), "Ardia p-1", "tab-3"), null);
});

const mailOnly = (opened) => ({ describe: async () => ({ name: "Mail", path: null, icon: null }), open: async (url) => (opened.push(url), true) });

test("two pages whose asks carry the same engine id each open only their own link", async () => {
  const opened = [];
  const asked = [];
  const apps = windowsExternalApps(() => mailOnly(opened), () => null, async (page, id) => (asked.push(`${page}/${id}`), true));
  const a = await apps.request(ask({ url: "mailto:a@a.example", origin: "https://a.example" }), "Ardia p-1", "tab-A");
  const b = await apps.request(ask({ url: "mailto:b@b.example", origin: "https://b.example" }), "Ardia p-1", "tab-B");
  assert.notEqual(a.id, b.id);
  assert.equal(await apps.resolve(a.id, true, false), true);
  assert.deepEqual(opened, ["mailto:a@a.example"]);
  assert.deepEqual(asked, ["tab-A/x1"]);
  apps.forget(a.id);
  assert.equal(await apps.resolve(b.id, true, false), true);
  assert.deepEqual(opened, ["mailto:a@a.example", "mailto:b@b.example"]);
});

test("a profile deleted while a yes waits for the engine keeps no allowance and opens nothing", async () => {
  const opened = [];
  const docs = new Map();
  let answer;
  const documents = { readDocument: (name) => docs.get(name) ?? null, writeDocument: (name, text) => void docs.set(name, text) };
  const apps = windowsExternalApps(() => mailOnly(opened), () => documents, () => new Promise((resolve) => (answer = resolve)));
  const asked = await apps.request(ask(), "Ardia p-1", "tab-1");
  const answered = apps.resolve(asked.id, true, true);
  await new Promise((resolve) => setImmediate(resolve));
  apps.forgetProfile("Ardia p-1");
  answer(true);
  assert.equal(await answered, false);
  assert.deepEqual(await apps.list("Ardia p-1"), []);
  assert.deepEqual(opened, []);
});

test("the self-check's gate, which skips the engine's liveness check, still needs a yes, refuses unhandled schemes and needs a gesture", async () => {
  const opened = [];
  const docs = new Map();
  const documents = { readDocument: (name) => docs.get(name) ?? null, writeDocument: (name, text) => void docs.set(name, text) };
  const apps = windowsExternalApps(() => ({ describe: async (scheme) => HANDLERS[scheme] ?? null, open: async (url) => (opened.push(url), true) }), () => documents, async () => true);
  const refused = await apps.request(ask({ url: "ardiaprogid:boom" }), "self-check", "page");
  assert.equal(refused.app, null);
  assert.equal(await apps.resolve(refused.id, true, true), false);
  const declined = await apps.request(ask({ url: "ardiatest:x" }), "self-check", "page");
  assert.equal(await apps.resolve(declined.id, false, true), false);
  assert.deepEqual(opened, []);
  const remembered = await apps.request(ask(), "self-check", "page");
  assert.equal(await apps.resolve(remembered.id, true, true), true);
  assert.notEqual(await apps.request(ask({ userGesture: false }), "self-check", "page"), null);
  assert.deepEqual(opened, ["mailto:someone@example.com"]);
});

test("ARDIA_TEST=externalAppLaunch reaches only the native background refusal and the self-check's opt-in", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const mentions = (text) => text.split("externalAppLaunch").length - 1;
  for (const path of ["../../../../packages/expo-windows/src/engine/domains/externalApps.ts", "../../../../packages/expo-windows/src/engine/domains/externalAppsNative.ts", "../../../../packages/expo-windows/src/engine/pages.ts", "../state/site/prompts.ts"]) {
    assert.equal(mentions(source(path)), 0, path);
  }
  const native = source("../../windows/Ardia/ExternalAppsModule.h");
  assert.equal(mentions(native), 1);
  assert.match(native, /if \(!config\.testInstance\) return false;\n  auto found = config\.test\.find\("externalAppLaunch"\);/);
  assert.deepEqual(native.split("\n").filter((line) => line.includes("LaunchAskedByTest()") && !line.includes("inline")), ["    if (AppLaunch::Background() && !ExternalApps::LaunchAskedByTest()) {"]);
  assert.match(source("../../../../packages/expo-windows/src/selfCheck/externalApps.ts"), /launchConfig\(\)\.test\.externalAppLaunch === "1"/);
});

test("a remembered open whose profile is deleted while the engine answers opens nothing and counts as refused", async () => {
  const opened = [];
  const docs = new Map();
  let answer = null;
  const documents = { readDocument: (name) => docs.get(name) ?? null, writeDocument: (name, text) => void docs.set(name, text) };
  const native = { describe: async () => HANDLERS.mailto, open: async (url) => (opened.push(url), true) };
  const apps = windowsExternalApps(() => native, () => documents, (page) => (page === "slow" ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(true)));
  const first = await apps.request(ask(), "Ardia p-1", "tab-1");
  await apps.resolve(first.id, true, true);
  opened.length = 0;
  windowsExternalAppCounts.takeLaunches();
  const automatic = apps.request(ask({ id: "x2" }), "Ardia p-1", "slow");
  while (!answer) await new Promise((resolve) => setImmediate(resolve));
  apps.forgetProfile("Ardia p-1");
  answer(true);
  assert.equal(await automatic, null);
  assert.deepEqual(opened, []);
  assert.deepEqual(windowsExternalAppCounts.takeLaunches(), { opened: 0, refused: 1, automatic: 0 });
});

test("a yes counts as a click, and only a launch Windows confirmed counts as a launch", async () => {
  takeExternalAppCounts();
  showExternalApp("t-count", { id: "w1", url: "mailto:a", scheme: "mailto", origin: null, app: "Mail", appPath: null, icon: null, title: "", message: "", remember: null });
  answerExternalApp("t-count", true, false);
  const clicked = takeExternalAppCounts();
  assert.deepEqual([clicked.external_app_allows, clicked.external_app_launches], [1, 0]);
  const { apps, gone } = fakes();
  windowsExternalAppCounts.takeLaunches();
  const stale = await apps.request(ask(), "Ardia p-1", "tab-1");
  gone.add("tab-1");
  assert.equal(await apps.resolve(stale.id, true, false), false);
  const live = await apps.request(ask({ id: "x2", url: "ardiatest:x" }), "Ardia p-1", "tab-2");
  assert.equal(await apps.resolve(live.id, true, false), true);
  assert.deepEqual(windowsExternalAppCounts.takeLaunches(), { opened: 1, refused: 1, automatic: 0 });
});

test("a host with a trailing dot keeps its site name and its own allowance, and look-alikes stay out", async () => {
  assert.equal(serializedOrigin("https://example.com."), "https://example.com.");
  assert.equal(trustworthyOrigin("https://example.com."), true);
  assert.equal(trustworthyOrigin("http://localhost.:3000"), true);
  for (const lookAlike of ["https://evil.example@bank.example", "https://evil.example.@bank.example", "https://example..com", "https://.", "https://example.com./", "https://example .com."]) {
    assert.equal(serializedOrigin(lookAlike), null, lookAlike);
  }
  const { apps } = fakes();
  const dotted = await apps.request(ask({ origin: "https://example.com." }), "Ardia p-1", "tab-1");
  assert.equal(dotted.message, "https://example.com. wants to open this application.");
  assert.notEqual(dotted.remember, null);
  await apps.resolve(dotted.id, true, true);
  assert.deepEqual((await apps.list("Ardia p-1")).map((allowance) => allowance.origin), ["https://example.com."]);
  assert.notEqual(await apps.request(ask({ id: "x2", origin: "https://example.com" }), "Ardia p-1", "tab-1"), null);
});
