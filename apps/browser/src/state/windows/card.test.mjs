import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { paneKeyOf } = await import("./card.ts");

const S = () => useBrowser.getState();
const MAIL = "https://mail.com";
const shownPaneKey = (w) => {
  const s = S();
  return paneKeyOf(s, s.tabs[model.activeTabId(s, w)]);
};

function sharedTileInBothSpaces(shareWith) {
  S().hydrate({});
  const w = S().createWindow({ url: MAIL });
  const [mail] = S().windows[w].tabIds;
  S().pinTabs([mail], true);
  S().activate(mail);
  const work = S().createProfile({ name: "Work", shareWith });
  S().switchProfile(w, work);
  return { w, mail, work };
}

test("a shared Top App keeps its pane key across a space switch", () => {
  const { w, mail, work } = sharedTileInBothSpaces("default");
  const copy = S().windows[w].tabIds.find((id) => S().tabs[id].profileId === work && S().tabs[id].pinnedUrl === MAIL);
  S().handOffPin(copy);
  assert.equal(S().tabs[mail].profileId, work, "the page came along to Work");
  const inWork = shownPaneKey(w);
  S().switchProfile(w, "default");
  assert.equal(model.activeTabId(S(), w), mail, "the same tab is on screen");
  assert.equal(S().tabs[mail].profileId, "default", "the page came back to Personal");
  assert.equal(shownPaneKey(w), inWork, "same pane in both spaces");
});

test("a shared Top App keeps its pin key through the page swap", () => {
  const { w, work } = sharedTileInBothSpaces("default");
  const tileIn = (profileId) => S().windows[w].tabIds.find((id) => S().tabs[id].profileId === profileId && S().tabs[id].pinnedUrl === MAIL);
  const before = { home: tileIn("default"), work: tileIn(work) };
  const keys = { home: model.pinKeyOf(S().tabs[before.home]), work: model.pinKeyOf(S().tabs[before.work]) };
  S().handOffPin(before.work);
  assert.equal(tileIn(work), before.home, "the swap trades the tab ids between the spaces");
  assert.equal(model.pinKeyOf(S().tabs[tileIn("default")]), keys.home);
  assert.equal(model.pinKeyOf(S().tabs[tileIn(work)]), keys.work);
  assert.equal(keys.home, keys.work);
});

test("spaces that share browsing data share a pane key; separate data doesn't", () => {
  const { work } = sharedTileInBothSpaces("default");
  const own = S().createProfile({ name: "Own", shareWith: null });
  const tab = (profileId) => ({ id: "t", profileId });
  assert.equal(paneKeyOf(S(), tab("default")), paneKeyOf(S(), tab(work)));
  assert.notEqual(paneKeyOf(S(), tab("default")), paneKeyOf(S(), tab(own)), "a different Chrome profile needs a new page view");
});
