import assert from "node:assert/strict";
import { test } from "node:test";
import { readExternalAppAsk, schemeOf, trustworthyOrigin, windowsExternalApps } from "../../../../packages/expo-windows/src/engine/domains/externalApps.ts";
import { noteExternalApp, takeExternalAppCounts } from "../state/telemetry/externalAppCounts.ts";

const HANDLERS = { mailto: { name: "Mail", path: "C:\\Mail\\mail.exe", icon: "data:image/png;base64,AA==" }, ardiatest: { name: "Test Handler", path: null, icon: null } };

function fakes() {
  const opened = [];
  const docs = new Map();
  const native = { describe: async (scheme) => HANDLERS[scheme] ?? null, open: async (url) => (opened.push(url), true) };
  const documents = { readDocument: (name) => docs.get(name) ?? null, writeDocument: (name, text) => void docs.set(name, text) };
  return { opened, docs, apps: windowsExternalApps(() => native, () => documents), native, documents };
}

const ask = (fields = {}) => ({ id: "x1", url: "mailto:someone@example.com", origin: "https://mail.example", userGesture: true, offTheRecord: false, ...fields });

test("a link with a handler asks with the handler's name and icon, in the Mac's words", async () => {
  const { apps, opened } = fakes();
  const request = await apps.request(ask(), "Ardia p-1");
  assert.deepEqual(request, {
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
  await apps.request(ask(), "Ardia p-1");
  assert.equal(await apps.resolve("x1", false, false), false);
  assert.equal(await apps.resolve("x1", true, false), false);
  assert.equal(await apps.resolve("nope", true, false), false);
  assert.deepEqual(opened, []);
  await apps.request(ask({ id: "x2" }), "Ardia p-1");
  assert.equal(await apps.resolve("x2", true, false), true);
  assert.deepEqual(opened, ["mailto:someone@example.com"]);
});

test("a remembered site opens the app with a gesture and asks without one; remembering needs a trustworthy origin and no private profile", async () => {
  const { apps, opened, docs } = fakes();
  await apps.request(ask(), "Ardia p-1");
  await apps.resolve("x1", true, true);
  assert.equal(docs.size, 1);
  assert.equal(await apps.request(ask({ id: "x2" }), "Ardia p-1"), null);
  assert.equal(opened.length, 2);
  const noGesture = await apps.request(ask({ id: "x3", userGesture: false }), "Ardia p-1");
  assert.equal(noGesture?.id, "x3");
  assert.equal(opened.length, 2);
  assert.equal((await apps.request(ask({ id: "x4", origin: "http://mail.example" }), "Ardia p-1"))?.remember, null);
  assert.equal((await apps.request(ask({ id: "x5", offTheRecord: true }), "Ardia p-1"))?.remember, null);
  assert.deepEqual(await apps.list("Ardia p-1"), [{ origin: "https://mail.example", scheme: "mailto", app: "Mail", icon: "data:image/png;base64,AA==" }]);
  apps.remove("Ardia p-1", "https://mail.example", "mailto");
  assert.deepEqual(await apps.list("Ardia p-1"), []);
});

test("a scheme with no handler says so and can't be opened", async () => {
  const { apps, opened } = fakes();
  const request = await apps.request(ask({ url: "zoommtg://join?x=1" }), "Ardia p-1");
  assert.equal(request?.app, null);
  assert.equal(request?.message, "Your PC doesn’t have an app for “zoommtg:” links.");
  assert.equal(await apps.resolve("x1", true, true), false);
  assert.deepEqual(opened, []);
});

test("only a well-formed scheme and a well-formed ask go further", () => {
  assert.equal(schemeOf("MailTo:a@b"), "mailto");
  assert.equal(schemeOf("ms-teams:x"), "ms-teams");
  assert.equal(schemeOf("1abc:x"), null);
  assert.equal(schemeOf("a b:x"), null);
  assert.equal(schemeOf(":x"), null);
  assert.equal(trustworthyOrigin("https://a.example"), true);
  assert.equal(trustworthyOrigin("http://localhost:8080"), true);
  assert.equal(trustworthyOrigin("http://a.example"), false);
  assert.equal(trustworthyOrigin("null"), false);
  assert.equal(readExternalAppAsk({ url: "mailto:a" }), null);
  assert.deepEqual(readExternalAppAsk({ id: "x9", url: "mailto:a", origin: "https://a.example", userGesture: true }), { id: "x9", url: "mailto:a", origin: "https://a.example", userGesture: true, offTheRecord: false });
});

test("app link prompts and answers are counted and reset once taken", () => {
  takeExternalAppCounts();
  noteExternalApp("asked");
  noteExternalApp("remembered");
  noteExternalApp("declined");
  assert.deepEqual(takeExternalAppCounts(), { external_app_prompts: 1, external_app_prompts_no_app: 0, external_app_opens: 0, external_app_opens_remembered: 1, external_app_declines: 1 });
});
