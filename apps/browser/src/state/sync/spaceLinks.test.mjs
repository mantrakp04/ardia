import assert from "node:assert/strict";
import { test } from "node:test";

let sequence = 0;
globalThis.acTestNativeModules = { ArdiaSync: { newDeviceId: () => `new-${++sequence}` } };
const { useBrowser } = await import("../browser/store.ts");
const { emptyScope, visible } = await import("@ardia/sync");
const { APP_SCOPE, emptyDoc } = await import("./syncDoc.ts");
const { addLinkedSpace, linkSpaces, readyToPair } = await import("./spaceLinks.ts");
const { spacesAdapter } = await import("./spaceAdapters.ts");
const { appAdapters } = await import("./scopeAdapters.ts");
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
  for (const p of [7, true, {}, [], "", " ", "\t\r\n", "personal", " personal "]) {
    useBrowser.getState().hydrate({});
    const doc = { ...emptyDoc(), joining: true, setupAt: Date.now() };
    const app = { ...emptyScope(), records: { "prof:home": record({ ...remoteSpace, d: true, p }) } };
    doc.scopes[APP_SCOPE] = app;
    assert.equal(readyToPair(doc, app), typeof p === "string" && !!p.trim());
    linkSpaces(doc, app);
    assert.equal(typeof doc.profiles.default.syncId, "string");
    assert.notEqual(doc.profiles.default.syncId, "");
    assert.notEqual(doc.profiles.default.syncId.trim(), "");
    if (typeof p === "string" && p.trim()) {
      assert.equal(doc.profiles.default.syncId, p);
      assert.equal(doc.spaces.default.syncId, "home");
    } else assert.equal(doc.spaces.default, undefined);
  }
});

test("a malformed default record cannot hide a later valid pairing hint", () => {
  for (const p of [null, 7, "", " "]) {
    useBrowser.getState().hydrate({});
    const doc = { ...emptyDoc(), joining: true, setupAt: Date.now() };
    const app = { ...emptyScope(), records: {
      "prof:broken": record({ ...remoteSpace, d: true, p }),
      "prof:home": record({ ...remoteSpace, d: true }),
    } };
    doc.scopes[APP_SCOPE] = app;
    linkSpaces(doc, app);
    assert.equal(doc.profiles.default.syncId, "personal");
    assert.equal(doc.spaces.default.syncId, "home");
  }
});

test("a newly paired default Space waits for its assigned Profile without publishing the old assignment", () => {
  useBrowser.getState().hydrate({});
  const doc = { ...emptyDoc(), joining: true, setupAt: Date.now() };
  const app = { ...emptyScope(), records: {
    "identity:personal": record({ n: "Personal", i: null, seed: true }),
    "prof:home": record({ ...remoteSpace, d: true, p: "work" }),
  } };
  doc.scopes[APP_SCOPE] = app;
  linkSpaces(doc, app);
  assert.equal(doc.profiles.default.syncId, "personal");
  assert.equal(doc.spaces.default.syncId, "home");
  assert.equal(doc.spaces.default.adopting, true);
  app.unapplied = [];
  appAdapters(doc, false);
  assert.ok(app.unapplied.includes("prof:home"));
  const adapter = spacesAdapter(() => doc.spaces, () => doc.profiles);
  const known = (key) => key in app.records;
  assert.equal(adapter.extract(() => undefined, () => false, Date.now(), known).values.has("prof:home"), false);
  assert.equal(adapter.apply(visible(app, "prof:"), new Set(["prof:home"]), () => undefined, { known }), false);
  app.records["identity:work"] = record({ n: "Work", i: null });
  linkSpaces(doc, app);
  assert.equal(adapter.apply(visible(app, "prof:"), new Set(["prof:home"]), () => undefined, { known }), true);
  const assigned = useBrowser.getState().spaces.default.profileId;
  assert.equal(doc.profiles[assigned].syncId, "work");
  assert.equal(doc.profiles[assigned].enabled, false);
  assert.equal(doc.spaces.default.adopting, undefined);
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
