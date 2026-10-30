import assert from "node:assert/strict";
import { test } from "node:test";

let sequence = 0;
globalThis.acTestNativeModules = { ArdiaSync: { newDeviceId: () => `new-${++sequence}` } };
const { useBrowser } = await import("../browser/store.ts");
const { emptyScope } = await import("@ardia/sync");
const { APP_SCOPE, emptyDoc } = await import("./syncDoc.ts");
const { addLinkedSpace, linkSpaces, readyToPair } = await import("./spaceLinks.ts");
const record = (v) => ({ h: "stamp", v, o: ["remote", 1] });
const remoteSpace = { n: "School", c: "blue", i: null, p: "personal" };

test("a joining Mac waits for its delayed default Space record before pairing", () => {
  useBrowser.getState().hydrate({});
  const doc = { ...emptyDoc(), joining: true, setupAt: Date.now() };
  const app = { ...emptyScope(), joined: true, records: { "identity:personal": record({ n: "Personal", i: null, seed: true }), "prof:school": record(remoteSpace) } };
  doc.scopes[APP_SCOPE] = app;
  assert.equal(readyToPair(doc, app), false);
  linkSpaces(doc, app);
  assert.equal(doc.spaces.default, undefined);
  app.records["prof:home"] = record({ ...remoteSpace, n: "Home", d: true });
  assert.equal(readyToPair(doc, app), true);
  linkSpaces(doc, app);
  assert.equal(doc.spaces.default.syncId, "home");
});

test("a joining Mac can create its own default Space link after the pairing deadline", () => {
  useBrowser.getState().hydrate({});
  const doc = { ...emptyDoc(), joining: true, setupAt: Date.now() - 2 * 86400000 };
  const app = { ...emptyScope(), records: { "identity:personal": record({ n: "Personal", i: null, seed: true }), "prof:school": record(remoteSpace) } };
  doc.scopes[APP_SCOPE] = app;
  assert.equal(readyToPair(doc, app), true);
  linkSpaces(doc, app);
  assert.ok(doc.spaces.default);
  assert.notEqual(doc.spaces.default.syncId, "school");
});

test("default Profile pairing uses only non-empty string remote Profile IDs", () => {
  for (const p of [7, true, {}, [], "", "personal"]) {
    useBrowser.getState().hydrate({});
    const doc = { ...emptyDoc(), joining: true, setupAt: Date.now() };
    const app = { ...emptyScope(), records: { "prof:home": record({ ...remoteSpace, d: true, p }) } };
    doc.scopes[APP_SCOPE] = app;
    linkSpaces(doc, app);
    assert.equal(typeof doc.profiles.default.syncId, "string");
    assert.notEqual(doc.profiles.default.syncId, "");
    if (p === "personal") {
      assert.equal(doc.profiles.default.syncId, p);
      assert.equal(doc.spaces.default.syncId, "home");
    } else assert.equal(doc.spaces.default, undefined);
  }
});

test("adding a remote Space leaves new Profile data and Top Apps consent off", () => {
  useBrowser.getState().hydrate({});
  const doc = emptyDoc();
  doc.scopes[APP_SCOPE] = { ...emptyScope(), records: { "identity:personal": record({ n: "Remote", i: null }) } };
  const id = addLinkedSpace(doc, "school", remoteSpace, null);
  const profileId = useBrowser.getState().spaces[id].profileId;
  assert.equal(doc.spaces[id].enabled, true);
  assert.equal(doc.profiles[profileId].enabled, false);
  assert.equal(doc.profiles[profileId].topAppsEnabled, false);
  addLinkedSpace(doc, "research", { ...remoteSpace, n: "Research" }, null);
  assert.equal(doc.profiles[profileId].enabled, false);
});
