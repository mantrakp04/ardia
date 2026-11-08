import assert from "node:assert/strict";
import { test } from "node:test";
import { shellNativeModules } from "../../test-native/index.ts";

const { connectCalendar, useCalendar } = await import("./calendar.ts");

const native = shellNativeModules.ArdiaCalendar;
const original = { ...native };

const stage = ({ status, request }) => {
  native.authorizationStatus = () => status;
  native.requestAccess = request;
};

test.afterEach(() => {
  Object.assign(native, original);
  useCalendar.setState({ access: "notDetermined", requesting: false, requestError: null, calendars: [], events: [] });
});

test("a request macOS fails shows the error macOS returned", async () => {
  stage({ status: "notDetermined", request: () => Promise.resolve({ status: "notDetermined", error: "The operation couldn't be completed. (EKErrorDomain error 100.)" }) });
  const granted = await connectCalendar();
  assert.equal(granted, false);
  assert.match(useCalendar.getState().requestError ?? "", /EKErrorDomain error 100/);
  assert.equal(useCalendar.getState().requesting, false);
});

test("a request that ends undecided without an error points to System Settings", async () => {
  stage({ status: "notDetermined", request: () => Promise.resolve({ status: "notDetermined", error: null }) });
  assert.equal(await connectCalendar(), false);
  assert.match(useCalendar.getState().requestError ?? "", /System Settings/);
});

test("write-only access is explained as not enough", async () => {
  stage({ status: "writeOnly", request: () => Promise.resolve({ status: "writeOnly", error: null }) });
  assert.equal(await connectCalendar(), false);
  assert.equal(useCalendar.getState().access, "writeOnly");
  assert.match(useCalendar.getState().requestError ?? "", /add events/);
});

test("a denial the user just chose is left to the denied copy", async () => {
  stage({ status: "denied", request: () => Promise.resolve({ status: "denied", error: null }) });
  assert.equal(await connectCalendar(), false);
  assert.equal(useCalendar.getState().access, "denied");
  assert.equal(useCalendar.getState().requestError, null);
});

test("a request that throws shows its message and ends the busy state", async () => {
  stage({ status: "notDetermined", request: () => Promise.reject(new Error("ArdiaCalendar is unavailable")) });
  assert.equal(await connectCalendar(), false);
  assert.match(useCalendar.getState().requestError ?? "", /ArdiaCalendar is unavailable/);
  assert.equal(useCalendar.getState().requesting, false);
});

test("the busy state shows while macOS decides and a second press shares the request", async () => {
  let release;
  let asked = 0;
  stage({
    status: "notDetermined",
    request: () => {
      asked += 1;
      return new Promise((resolve) => (release = () => resolve({ status: "notDetermined", error: null })));
    },
  });
  const first = connectCalendar();
  const second = connectCalendar();
  assert.equal(useCalendar.getState().requesting, true);
  release();
  await Promise.all([first, second]);
  assert.equal(asked, 1);
  assert.equal(useCalendar.getState().requesting, false);
});

test("a later grant clears the earlier error", async () => {
  stage({ status: "notDetermined", request: () => Promise.resolve({ status: "notDetermined", error: "boom" }) });
  await connectCalendar();
  assert.equal(useCalendar.getState().requestError !== null, true);
  stage({ status: "fullAccess", request: () => Promise.resolve({ status: "fullAccess", error: null }) });
  assert.equal(await connectCalendar(), true);
  assert.equal(useCalendar.getState().requestError, null);
  assert.equal(useCalendar.getState().access, "fullAccess");
});
