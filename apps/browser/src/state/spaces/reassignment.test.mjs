import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { engineProfileForSpace, privateSession, viewTabIds } from "../browser/model.ts";
import { spacesAdapter } from "../sync/spaceAdapters.ts";
import { chromeChanged, stripPlan } from "../tabs/liveTabs.ts";
import { extensionsProfileId } from "../extensions/store.ts";

const S = () => useBrowser.getState();

test("reassignment loads the committed URL and leaves unloaded tabs lazy", () => {
  S().hydrate({});
  const profile = S().createProfile({ name: "Work" });
  const window = S().createWindow({ url: "https://site.test/start" });
  const tab = viewTabIds(S(), window)[0];
  S().updateTab(tab, { url: "https://site.test/current" });
  const lazy = S().newTab(window, { url: "https://lazy.test", snapshot: { url: "https://lazy.test" }, background: true });
  S().updateTab(lazy, { page: { kind: "asleep" } });
  S().assignSpaceProfile("default", profile);
  assert.equal(S().tabs[tab].page.nav.url, "https://site.test/current");
  assert.equal(S().tabs[lazy].page.kind, "asleep");
});

test("remote assignment waits for consent while content is live and cannot publish the old assignment", () => {
  S().hydrate({});
  const profile = S().createProfile({ name: "Work" });
  S().createWindow({ url: "https://site.test/form" });
  const links = { default: { syncId: "space", enabled: true } };
  const identities = { default: { syncId: "home", enabled: true }, [profile]: { syncId: "work", enabled: true } };
  const adapter = spacesAdapter(() => links, () => identities);
  adapter.apply(new Map([["prof:space", { n: "Home", c: "plum", i: null, p: "work" }]]), new Set(["prof:space"]), () => undefined, { known: () => false });
  assert.equal(S().spaces.default.profileId, "default");
  assert.equal(links.default.pendingProfileId, profile);
  assert.equal(adapter.extract(() => undefined, () => false, Date.now(), () => true).values.has("prof:space"), false);
});

test("native selection reveals an inactive Space even when its selected tab was remembered", () => {
  S().hydrate({});
  const other = S().createSpace({ name: "School", profileId: "default" });
  const window = S().createWindow({ url: "https://home.test" });
  const home = viewTabIds(S(), window)[0];
  const destination = S().newTab(window, { spaceId: other, url: "https://school.test" });
  S().switchSpace(window, "default");
  const strip = (selected) => ({ strip: 1, window: 1, appWindow: window, profile: "", tabs: [home, destination].map((key, index) => ({ key, browser: index + 1, index, active: key === selected, pinned: false })) });
  const next = chromeChanged(S(), strip(home), strip(destination), { seen: new Set([home, destination]) });
  assert.equal(next.windows[window].spaceId, other);
  assert.equal(stripPlan(next, strip(destination)).active, destination);
});

test("an existing private window retains its identity when its source Space is reassigned", () => {
  S().hydrate({});
  const profile = S().createProfile({ name: "Work" });
  const window = S().createWindow({ kind: "private", spaceId: "default", url: "https://form.test" });
  const spaceId = S().windows[window].spaceId;
  const before = engineProfileForSpace(spaceId);
  S().assignSpaceProfile("default", profile);
  assert.equal(engineProfileForSpace(spaceId), before);
  assert.equal(privateSession(S(), spaceId), "");
  assert.equal(extensionsProfileId(null, window), "default");
  S().deleteProfile("default");
  assert.ok(S().profiles.default, "a live private context still uses its Profile");
});
