import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const flagged = (id, state) => ({
  id, url: `http://dl.example/${id}.dmg`, filename: `${id}.dmg`, path: `/tmp/${id}.dmg`, state, paused: false, received: 1, total: 2,
  speed: 0, mimeType: "", profile: "", offTheRecord: false, dangerous: state === "downloading",
});
const listed = (id) => S().downloads.some((d) => d.id === id);

test("a discarded download stays gone, and the panel shut, when the engine's late updates for it arrive", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const w = S().createWindow({ url: "https://a.example/" });
  S().setFocusedWindow(w);
  S().upsertDownload(flagged("discarded", "downloading"));
  assert.ok(listed("discarded"));
  S().setDownloadsOpen(w, false);
  S().discardDownload("discarded");
  assert.ok(!listed("discarded"));
  S().upsertDownload(flagged("discarded", "cancelled"));
  S().upsertDownload(flagged("discarded", "downloading"));
  assert.ok(!listed("discarded"), "a late update never brings the row back");
  assert.equal(S().windowUi[w]?.downloadsOpen, false, "nor opens the panel");
  S().upsertDownload(flagged("other", "downloading"));
  assert.ok(listed("other"), "other downloads still list");
});
