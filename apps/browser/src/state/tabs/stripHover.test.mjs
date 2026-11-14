import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { STRIP_HOVER_DELAY_MS, stripChipEntered, stripChipLeft, stripPageOffstage, useStripHover } = await import("./stripHover.ts");

const S = () => useBrowser.getState();
const anchor = { x: 10, y: 0, width: 100, height: 30 };
const measure = async () => anchor;
const settle = () => new Promise((resolve) => setTimeout(resolve, STRIP_HOVER_DELAY_MS.show + 50));

function twoProfiles() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://example.com/start" });
  const work = S().createProfile({ name: "Work" });
  const mine = S().newTab(w, { url: "https://example.com/mine", profileId: S().windows[w].profileId, background: true });
  const theirs = S().newTab(w, { url: "https://example.com/theirs", profileId: work, background: true });
  return { w, home: S().windows[w].profileId, work, mine, theirs };
}

test("a strip page going offstage takes down the card of its own tab and leaves another page's card up", () => {
  const { w, home, work, theirs } = twoProfiles();
  useStripHover.setState({ hover: { windowId: w, tabId: theirs, anchor } });
  stripPageOffstage(w, home);
  assert.equal(useStripHover.getState().hover?.tabId, theirs);
  stripPageOffstage(w, work);
  assert.equal(useStripHover.getState().hover, null);
});

test("a card still waiting to show never shows once its page has gone offstage", async () => {
  const { w, work, theirs } = twoProfiles();
  useStripHover.setState({ hover: null });
  stripChipEntered(w, theirs, measure);
  stripPageOffstage(w, work);
  await settle();
  assert.equal(useStripHover.getState().hover, null);
});

test("the page that is now current keeps the card it just started for its own tab", async () => {
  const { w, work, mine } = twoProfiles();
  useStripHover.setState({ hover: null });
  stripChipEntered(w, mine, measure);
  stripPageOffstage(w, work);
  await settle();
  assert.equal(useStripHover.getState().hover?.tabId, mine);
  stripChipLeft(w, mine);
});
