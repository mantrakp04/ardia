import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { emptyScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");
const { summarize } = await import("./syncSummary.ts");
const { emptyDoc } = await import("./syncDoc.ts");
const records = await import("./records.ts");

const now = Date.now();
const record = (v) => ({ h: "0", v, o: ["devB", 1] });

test("a malformed history record from another Mac neither expires nor stalls compaction", () => {
  for (const bad of [null, 7, { t: "x", n: 1 }, { t: "x", n: 1, vt: "soon" }, { t: "x", n: 1, vt: [1, "2"] }]) {
    assert.equal(adapters.historyExpired("h:https://a.example/", bad, now), false);
  }
  assert.equal(adapters.historyExpired("h:https://a.example/", { t: "x", n: 1, vt: [1] }, now), true);
});

test("a malformed history record leaves the local entry alone instead of deleting it", async () => {
  const entry = { url: "https://kept.example/", title: "Kept", favicon: null, visits: 1, lastVisit: now, visitTimes: [now] };
  useBrowser.setState({ history: { "": { list: [entry], floor: -Infinity, ready: true } } });
  const view = new Map([["h:https://kept.example/", { t: "Kept", n: "many" }]]);
  const applied = await adapters.historyAdapter("default").apply(view, new Set(view.keys()), () => undefined, { known: () => true, now, horizon: 0, joined: true });
  assert.deepEqual(useBrowser.getState().history[""].list.map((e) => e.url), ["https://kept.example/"]);
  assert.equal(applied, false, "not applied, so the scope keeps its base and never reads the gap as a deletion to publish");
});

test("devices, their tabs and other Macs' profiles with malformed records drop out of the summary", () => {
  const doc = { ...emptyDoc(), enabled: true, deviceId: "devA", profiles: { default: { syncId: "s1", enabled: true } } };
  doc.scopes.app = { ...emptyScope(), records: { "dev:devB": record({ n: "B" }), "dev:devC": record({ n: 3 }), "prof:x": record({ n: "Work", c: "blue" }), "prof:y": record({ n: 5 }) } };
  doc.scopes["p:s1"] = { ...emptyScope(), records: { "tabs:devB": record({ n: "B", tabs: "none" }), "tabs:devC": record({ n: "C", tabs: [{ u: "https://c.example/", t: "C" }] }) } };
  const summary = summarize(doc);
  assert.deepEqual(summary.devices.map((d) => d.id), ["devB"]);
  assert.deepEqual(summary.remoteTabs.default, []);
  assert.deepEqual(summary.remoteProfiles.map((p) => p.syncId), ["x"]);
});

test("decoders keep records written by older and newer Macs that carry the fields we read", () => {
  assert.ok(records.profileRecord({ n: "Personal", c: "plum" }));
  assert.ok(records.profileRecord({ n: "Personal", c: "plum", i: null, d: true, th: null, extra: 1 }));
  assert.ok(records.bookmarkValue({ k: "f", p: "bar", t: "F", a: 1, pos: "a" }));
  assert.equal(records.bookmarkValue({ k: "u", p: "bar", t: "F", a: 1 }), null);
  assert.ok(records.passwordValue({ o: "https://a.example", u: "me", s: "sealed" }));
});
