import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { profilesAdapter, topAppsAdapter } from "./identityAdapters.ts";

const S = () => useBrowser.getState();
const app = { key: "mail", url: "https://mail.test/", title: "Mail", favicon: null, customTitle: null, customIcon: null };

test("invalid remote Profile metadata preserves the local identity and adoption state", () => {
  for (const record of [null, "invalid", [], {}, { n: 7, i: null }, { n: "Remote", i: false }]) {
    S().hydrate({});
    const link = { syncId: "personal", enabled: true, topAppsEnabled: true, adopting: true };
    const visible = new Map([["identity:personal", record]]);
    profilesAdapter(() => ({ default: link })).apply(visible, new Set(visible.keys()));
    assert.equal(S().profiles.default.name, "Personal");
    assert.equal(S().profiles.default.icon, null);
    assert.equal(link.adopting, true);
  }
  const link = { syncId: "personal", enabled: true, topAppsEnabled: true, adopting: true };
  profilesAdapter(() => ({ default: link })).apply(new Map([["identity:personal", { n: "Remote", i: null }]]), new Set(["identity:personal"]));
  assert.equal(S().profiles.default.name, "Remote");
  assert.equal(link.adopting, undefined);
});

test("invalid remote Top Apps leave the complete local list and sync baseline unapplied", () => {
  for (const record of [null, {}, { ...app, pos: null }, { ...app, pos: "" }, { ...app, pos: "V", url: 3 }, { ...app, pos: "V", tileFolder: { id: "f" } }, { ...app, key: "different", pos: "V" }]) {
    S().hydrate({ topApps: { default: [app] } });
    const visible = new Map([["app:mail", { ...app, pos: "A" }], ["app:broken", record]]);
    let applied;
    assert.doesNotThrow(() => { applied = topAppsAdapter("default").apply(visible); });
    assert.equal(applied, false);
    assert.deepEqual(S().topApps.default, [app]);
  }
});

test("valid remote Top Apps sort by position and preserve folder metadata", () => {
  S().hydrate({});
  const second = { ...app, key: "second", tileFolder: { id: "f", name: "Folder" } };
  assert.equal(topAppsAdapter("default").apply(new Map([["app:second", { ...second, pos: "Z" }], ["app:mail", { ...app, pos: "A" }]])), true);
  assert.deepEqual(S().topApps.default, [app, second]);
});
