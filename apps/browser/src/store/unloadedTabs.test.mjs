import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { isPageUnloaded } = await import("./pinShare.ts");

const S = () => useBrowser.getState();
const unloaded = (id) => isPageUnloaded(S(), id);
const tileOf = (w, url) => model.viewTabIds(S(), w).find((id) => S().tabs[id].pinned && S().tabs[id].pinnedUrl === url);

test("a tab counts as unloaded only while it has no page anywhere", () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  const docs = S().newTab(a, { url: "https://docs.com", background: true });
  assert.equal(unloaded(mail), false, "a loaded tab");
  assert.equal(unloaded(docs), false, "a background tab that has its page");

  S().pinTabs([mail], true, true);
  S().activate(mail);
  S().closeTab(mail);
  assert.equal(unloaded(mail), true, "a closed pinned row");
  S().activate(mail);
  assert.equal(unloaded(mail), false, "selecting it loads it again");

  const b = S().createWindow({ url: "https://b.com" });
  const copy = tileOf(b, "https://mail.com");
  assert.equal(unloaded(copy), false, "a pin whose page another window holds, before it's selected");
  S().activate(copy);
  const frozen = tileOf(a, "https://mail.com");
  assert.ok(S().tabs[frozen].pageIn, "A's copy shows the page B now holds");
  assert.equal(unloaded(frozen), false, "a pin live in another window");
});

test("a pin whose live page sits in a split can't be handed over, so its copy counts as unloaded", () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  const regular = S().newTab(a, { url: "https://docs.com", background: true });
  S().pinTabs([mail], true);
  S().activate(mail);
  S().createSplit([mail, regular]);
  const b = S().createWindow({ url: "https://b.com" });
  assert.equal(unloaded(tileOf(b, "https://mail.com")), true);
});
