import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { readDocument } = await import("../../platform/documents.ts");
const { useBoostStore, loadBoosts, boostsDocument } = await import("./store.ts");
const actions = await import("./actions.ts");
const { startBoosts } = await import("./persist.ts");
const { openBoostEditor, closeBoostEditor } = await import("./editor.ts");
const { validBoost } = await import("./valid.ts");

function reset() {
  useBoostStore.setState({ boostsByProfile: {} });
  useBrowser.getState().hydrate({});
}

test("creating, editing, switching and deleting a boost", () => {
  reset();
  const boost = actions.createBoost("default", "www.example.com");
  assert.equal(boost.domain, "example.com");
  assert.equal(boost.enabled, true);
  actions.updateBoost("default", boost.id, { name: "Dark", textCase: "upper" });
  actions.setBoostEnabled("default", boost.id, false);
  const [saved] = useBoostStore.getState().boostsByProfile.default;
  assert.equal(saved.name, "Dark");
  assert.equal(saved.textCase, "upper");
  assert.equal(saved.enabled, false);
  actions.resetBoost("default", boost.id);
  assert.equal(useBoostStore.getState().boostsByProfile.default[0].textCase, "none");
  assert.equal(useBoostStore.getState().boostsByProfile.default[0].name, "Dark");
  actions.deleteBoost("default", boost.id);
  assert.deepEqual(useBoostStore.getState().boostsByProfile.default, []);
});

test("importing starts a new boost on the given site and drops JS", () => {
  reset();
  const original = actions.createBoost("default", "a.com");
  const copy = actions.importBoost("default", "b.com", { ...original, js: "alert(1)" });
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.domain, "b.com");
  assert.equal(copy.js, "");
  assert.equal(actions.importBoost("default", null, { ...original, domain: "c.com" }).domain, "c.com");
});

test("incognito edits are no-ops and read the parent profile", () => {
  reset();
  const boost = actions.createBoost("default", "example.com");
  const ghost = actions.createBoost("incognito:1@default", "example.com");
  assert.ok(ghost.id);
  actions.updateBoost("incognito:1@default", boost.id, { name: "Hacked" });
  actions.deleteBoost("incognito:1@default", boost.id);
  assert.deepEqual(useBoostStore.getState().boostsByProfile.default.map((b) => b.name), ["example.com"]);
  assert.equal(useBoostStore.getState().boostsByProfile["incognito:1@default"], undefined);
});

test("a malformed boost is rejected", () => {
  const good = { name: "n", author: "", domain: "a.com", subdomains: false, enabled: true, colors: null, font: null, size: 100, textCase: "none", zaps: [], css: "", js: "", modified: 1 };
  assert.ok(validBoost("x", good));
  assert.equal(validBoost("x", { ...good, size: 99 }), null);
  assert.equal(validBoost("x", { ...good, domain: " " }), null);
  for (const domain of ["com", "co.uk", "www.com", "uk"]) assert.equal(validBoost("x", { ...good, domain }), null, domain);
  for (const domain of ["example.com/path", "a b.com", "exa_mple.com:80"]) assert.equal(validBoost("x", { ...good, domain }), null, domain);
  assert.ok(validBoost("x", { ...good, domain: "localhost" }));
  assert.ok(validBoost("x", { ...good, domain: "example.co.uk" }));
  assert.equal(validBoost("x", { ...good, zaps: [1] }), null);
  assert.equal(validBoost("x", { ...good, colors: { hue: 1 } }), null);
});

test("the editor opens and closes per window", () => {
  openBoostEditor("w1", "t1", "b1");
  openBoostEditor("w2", "t2", "b2");
  closeBoostEditor("w1");
  closeBoostEditor("w1");
});

test("boosts are saved per profile and read back", () => {
  reset();
  const stop = startBoosts();
  const boost = actions.createBoost("default", "example.com");
  actions.updateBoost("default", boost.id, { zaps: [".ad"] });
  stop();
  const saved = JSON.parse(readDocument(boostsDocument("default")));
  assert.equal(saved.version, 1);
  assert.equal(saved.boosts[0].zaps[0], ".ad");
  useBoostStore.setState({ boostsByProfile: {} });
  assert.deepEqual(loadBoosts("default").map((b) => b.id), [boost.id]);
});

test("a boost past the engine's limits is dropped", () => {
  const ok = { name: "n", author: "", domain: "example.com", subdomains: false, enabled: true, colors: null, font: null, size: 100, textCase: "none", zaps: [], css: "", js: "", modified: 1 };
  assert.ok(validBoost("x", ok));
  assert.equal(validBoost("x".repeat(129), ok), null);
  assert.equal(validBoost("x", { ...ok, css: "a".repeat(1024 * 1024 + 1) }), null);
  assert.equal(validBoost("x", { ...ok, js: "a".repeat(1024 * 1024 + 1) }), null);
});

test("code past the engine's limit isn't stored", () => {
  reset();
  const boost = actions.createBoost("default", "example.com");
  actions.updateBoost("default", boost.id, { css: "a{}" });
  actions.updateBoost("default", boost.id, { css: "a".repeat(1024 * 1024 + 1) });
  assert.equal(useBoostStore.getState().boostsByProfile.default.find((b) => b.id === boost.id).css, "a{}");
});
