import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { activateFocusedPane } = await import("./card.ts");

const S = () => useBrowser.getState();

function splitBesideVideo() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://video.com/" });
  const video = S().windows[w].tabIds[0];
  const left = S().newTab(w, { url: "https://left.com/", background: true });
  const right = S().newTab(w, { url: "https://right.com/", background: true });
  S().createSplit([left, right]);
  return { w, video, left, right };
}

test("focus in a shown split's other pane makes that pane the active one", () => {
  const { w, left, right } = splitBesideVideo();
  S().activate(left);
  activateFocusedPane(right);
  assert.equal(activeTabId(S(), w), right);
});

test("focus landing in a hidden split pane leaves the shown tab in front", () => {
  const { w, video, left } = splitBesideVideo();
  S().activate(left);
  S().activate(video);
  activateFocusedPane(left);
  assert.equal(activeTabId(S(), w), video, "PiP's Back to Tab brought the video forward; the split's old focus must not pull it back");
});
