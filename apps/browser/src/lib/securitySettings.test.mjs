import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../test-native-stub.mjs");
const { useBrowser } = await import("../store/browser.ts");
const { flushPersistence, loadSession, startPersistence } = await import("./persist.ts");

const OFF = "cliControl=false;allowJavaScriptFromAppleEvents=false";
const session = (settings) =>
  stub.docs.set(
    "session.json",
    JSON.stringify({ version: 2, profiles: {}, profileOrder: [], settings, windows: [], windowOrder: [], focusedWindowId: null, tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [] }),
  );
stub.securitySeal.on = true;

test("security settings the app didn't record are turned off at launch, and the off state is recorded", () => {
  stub.securitySeal.approved = null;
  session({ cliControl: true, allowJavaScriptFromAppleEvents: true });
  const { settings } = loadSession();
  assert.equal(settings.cliControl, false);
  assert.equal(settings.allowJavaScriptFromAppleEvents, false);
  assert.equal(stub.securitySeal.approved, OFF);
});

test("a recorded off state doesn't let a truthy non-boolean through", () => {
  stub.securitySeal.approved = OFF;
  session({ cliControl: 1 });
  assert.equal(loadSession().settings.cliControl, false);
});

test("values the app recorded survive a relaunch", () => {
  stub.securitySeal.approved = "cliControl=true;allowJavaScriptFromAppleEvents=false";
  session({ cliControl: true, allowJavaScriptFromAppleEvents: false });
  assert.equal(loadSession().settings.cliControl, true);
});

test("changing a security setting records it, other settings don't", () => {
  stub.securitySeal.approved = null;
  session({});
  const stop = startPersistence();
  stub.securitySeal.writes.length = 0;
  useBrowser.getState().updateSettings({ cliControl: true });
  assert.deepEqual(stub.securitySeal.writes, ["cliControl=true;allowJavaScriptFromAppleEvents=false"]);
  useBrowser.getState().updateSettings({ showFullUrl: true });
  assert.equal(stub.securitySeal.writes.length, 1);
  useBrowser.getState().updateSettings({ cliControl: false });
  assert.equal(stub.securitySeal.approved, OFF);
  flushPersistence({ final: true });
  stop();
});

test("a failed seal keeps the old approval pending and records the off value on retry", async () => {
  const ON = "cliControl=true;allowJavaScriptFromAppleEvents=false";
  stub.securitySeal.approved = ON;
  session({ cliControl: true, allowJavaScriptFromAppleEvents: false });
  let fail = true;
  globalThis.acTestSeal = (values) => {
    if (fail) return false;
    stub.securitySeal.writes.push(values);
    stub.securitySeal.approved = values;
    return true;
  };
  const stop = startPersistence();
  stub.securitySeal.writes.length = 0;
  useBrowser.getState().updateSettings({ cliControl: false });
  assert.equal(stub.securitySeal.approved, ON);
  assert.deepEqual(stub.securitySeal.writes, []);
  fail = false;
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(stub.securitySeal.approved, OFF);
  globalThis.acTestSeal = null;
  flushPersistence({ final: true });
  stop();
});

test("a launch with everything off records the off state when the seal doesn't match", () => {
  stub.securitySeal.approved = "cliControl=true;allowJavaScriptFromAppleEvents=false";
  session({});
  loadSession();
  assert.equal(stub.securitySeal.approved, OFF);
});
