import { test } from "node:test";
import assert from "node:assert/strict";
import { dispositionFor } from "./disposition.ts";
import { paneToReuse } from "../../store/splits.ts";

test("command bar modifiers pick where the result opens", () => {
  assert.equal(dispositionFor({}), "current");
  assert.equal(dispositionFor({ metaKey: true }), "background");
  assert.equal(dispositionFor({ altKey: true }), "split");
  assert.equal(dispositionFor({ shiftKey: true }), "newWindow");
  assert.equal(dispositionFor({ metaKey: true, altKey: true }), "background");
});

test("a link split reuses the pane to its right", () => {
  const splits = { a: { id: "a", tabIds: ["t1", "t2"] } };
  assert.equal(paneToReuse({ splits: {} }, "t1"), null);
  assert.equal(paneToReuse({ splits }, "t1"), "t2");
  assert.equal(paneToReuse({ splits }, "t2"), null);
  const full = { a: { id: "a", tabIds: ["t1", "t2", "t3"] } };
  assert.equal(paneToReuse({ splits: full }, "t2"), "t3");
  assert.equal(paneToReuse({ splits: full }, "t3"), null);
});

test("a background tab in a group leaves the current tab in front", async () => {
  const { useBrowser } = await import("../../store/browser.ts");
  const S = () => useBrowser.getState();
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  const group = S().groupTabs([a], { name: "G" });
  const before = S().windows[w].activeTabIds;
  const back = S().newTabInGroup(group, { background: true });
  assert.ok(S().groups[group].tabIds.includes(back));
  assert.deepEqual(S().windows[w].activeTabIds, before);
  const front = S().newTabInGroup(group);
  assert.ok(Object.values(S().windows[w].activeTabIds).includes(front));
});
