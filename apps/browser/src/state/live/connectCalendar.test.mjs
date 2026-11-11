import assert from "node:assert/strict";
import { test } from "node:test";
import { shellNativeModules, windows } from "../../test-native/index.ts";

const { connectCalendar, refreshCalendar, startCalendar, useCalendar } = await import("./calendar.ts");
const { slowTimersForTests } = await import("../../platform/slowTimers.ts");

const native = shellNativeModules.ArdiaCalendar;
const app = shellNativeModules.ArdiaApp;
const original = { native: { ...native }, openExternalURL: app.openExternalURL };
const PRIVACY = "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";
let opened = [];
let asked = 0;

const stage = ({ status, after = status, error = null, responsible = "self" }) => {
  let current = status;
  native.authorizationStatus = () => current;
  native.requestAccess = () => {
    asked += 1;
    current = after;
    return Promise.resolve({ granted: after === "fullAccess", status: after, error, responsible, ms: 5 });
  };
};

test.beforeEach(() => {
  opened = [];
  asked = 0;
  app.openExternalURL = (url) => {
    opened.push(url);
    return Promise.resolve(true);
  };
});

test.afterEach(() => {
  Object.assign(native, original.native);
  app.openExternalURL = original.openExternalURL;
  useCalendar.setState({ access: "notDetermined", requesting: false, requestError: null, calendars: [], events: [] });
});

test("a grant connects without opening System Settings", async () => {
  stage({ status: "notDetermined", after: "fullAccess" });
  assert.equal(await connectCalendar(), true);
  assert.equal(useCalendar.getState().access, "fullAccess");
  assert.equal(useCalendar.getState().requestError, null);
  assert.deepEqual(opened, []);
});

test("Connect when access was already denied opens the Calendars pane instead of asking macOS again", async () => {
  stage({ status: "denied" });
  assert.equal(await connectCalendar(), false);
  assert.equal(asked, 0);
  assert.deepEqual(opened, [PRIVACY]);
  assert.match(useCalendar.getState().requestError ?? "", /Turn on Ardia/);
});

test("add-only access opens the Calendars pane and asks for Full Access", async () => {
  stage({ status: "writeOnly" });
  assert.equal(await connectCalendar(), false);
  assert.deepEqual(opened, [PRIVACY]);
  assert.match(useCalendar.getState().requestError ?? "", /Full Access/);
});

test("a request macOS answers without asking opens the Calendars pane and says so", async () => {
  stage({ status: "notDetermined" });
  assert.equal(await connectCalendar(), false);
  assert.equal(asked, 1);
  assert.deepEqual(opened, [PRIVACY]);
  assert.match(useCalendar.getState().requestError ?? "", /didn't ask/);
});

test("a request macOS fails shows its error", async () => {
  stage({ status: "notDetermined", error: "The operation couldn't be completed. (EKErrorDomain error 100.)" });
  await connectCalendar();
  assert.match(useCalendar.getState().requestError ?? "", /EKErrorDomain error 100/);
  assert.equal(useCalendar.getState().requesting, false);
});

test("a request macOS sent to the app that opened Ardia says to reopen Ardia, without opening System Settings", async () => {
  stage({ status: "notDetermined", responsible: "other" });
  await connectCalendar();
  assert.deepEqual(opened, []);
  assert.match(useCalendar.getState().requestError ?? "", /open it from the Dock or Finder/);
});

test("a launcher-attributed request macOS refused keeps its error and only suggests reopening", async () => {
  stage({ status: "notDetermined", responsible: "other", error: "Missing entitlement" });
  await connectCalendar();
  const message = useCalendar.getState().requestError ?? "";
  assert.match(message, /Missing entitlement/);
  assert.match(message, /may have checked the app that opened Ardia/);
});

test("a denial just chosen in macOS's prompt explains it but leaves System Settings closed", async () => {
  stage({ status: "notDetermined", after: "denied" });
  await connectCalendar();
  assert.deepEqual(opened, []);
  assert.match(useCalendar.getState().requestError ?? "", /isn't allowed/);
});

test("a build whose request resolves a bare boolean still connects", async () => {
  let current = "notDetermined";
  native.authorizationStatus = () => current;
  native.requestAccess = () => {
    current = "fullAccess";
    return Promise.resolve(true);
  };
  assert.equal(await connectCalendar(), true);
});

test("a request that throws shows its message and ends the busy state", async () => {
  native.authorizationStatus = () => "notDetermined";
  native.requestAccess = () => Promise.reject(new Error("ArdiaCalendar is unavailable"));
  assert.equal(await connectCalendar(), false);
  assert.match(useCalendar.getState().requestError ?? "", /ArdiaCalendar is unavailable/);
  assert.equal(useCalendar.getState().requesting, false);
});

test("a second press while macOS decides shares the first request", async () => {
  let release;
  native.authorizationStatus = () => "notDetermined";
  native.requestAccess = () => {
    asked += 1;
    return new Promise((resolve) => (release = () => resolve({ granted: false, status: "notDetermined", error: null, responsible: "self", ms: 1 })));
  };
  const first = connectCalendar();
  const second = connectCalendar();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(useCalendar.getState().requesting, true);
  release();
  await Promise.all([first, second]);
  assert.equal(asked, 1);
  assert.equal(useCalendar.getState().requesting, false);
});

test("coming back from System Settings picks up the access just allowed", async () => {
  stage({ status: "denied" });
  startCalendar();
  await refreshCalendar();
  await connectCalendar();
  assert.notEqual(useCalendar.getState().requestError, null);
  native.authorizationStatus = () => "fullAccess";
  windows.emit({ type: "focus", id: "main" });
  for (let turn = 0; turn < 20 && useCalendar.getState().access !== "fullAccess"; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(useCalendar.getState().access, "fullAccess");
  assert.equal(useCalendar.getState().requestError, null);
  slowTimersForTests(Date.now).clear();
});
