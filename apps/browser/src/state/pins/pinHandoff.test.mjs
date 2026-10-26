import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { startPinHandoff } = await import("./pinHandoff.ts");
const { webviews, webviewRef } = await import("../../platform/webviews.ts");
const { withLivePage } = await import("../tabs/livePage.ts");

const S = () => useBrowser.getState();
const tileOf = (w, url) => model.viewTabIds(S(), w).find((id) => S().tabs[id].pinned && S().tabs[id].pinnedUrl === url);
const until = async (test, ms = 2000) => {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return test();
};

function twoWindows() {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  S().newTab(a, { url: "https://a.com" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.com" });
  return { a, b, mail };
}

const page = (calls, slow = 0) => ({
  capturePicture: () => new Promise((r) => setTimeout(() => r({ data: "AA", frame: [0, 0, 1, 1] }), slow)),
  goBack: () => calls.push("back"),
  reload: () => calls.push("reload"),
});

startPinHandoff();

test("a handoff still capturing loses to anything the user does in that window meanwhile", async () => {
  const { a, b, mail } = twoWindows();
  webviewRef(mail)(page([], 80));
  const copy = tileOf(b, "https://mail.com");
  const regular = S().windows[b].activeTabIds.default;
  S().activate(copy);
  S().activate(regular);
  S().activate(regular);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(S().tabs[mail].windowId, a, "switching away and back cancels the pending move");

  S().activate(copy);
  S().openPanel(b);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(S().tabs[mail].windowId, a, "opening the command bar cancels it too");
  assert.equal(S().windowUi[b].panel.open, true, "and the command bar stays open");

  S().closePanel(b);
  S().activate(copy);
  assert.ok(await until(() => S().tabs[mail].windowId === b), "an undisturbed request moves the page");
  webviews.delete(mail);
});

test("Back, Forward or Reload on a frozen copy pull the page back, then run on it there", async () => {
  const { a, b, mail } = twoWindows();
  webviewRef(mail)(page([]));
  S().activate(tileOf(b, "https://mail.com"));
  assert.ok(await until(() => S().tabs[mail].windowId === b));
  const frozen = S().windows[a].activeTabIds.default;
  assert.equal(S().tabs[frozen].pageIn, mail);
  S().updateLive(mail, { canGoBack: true });
  const calls = [];
  withLivePage(frozen, (p) => p.goBack());
  assert.ok(await until(() => S().tabs[mail].windowId === a), "the page comes back to A");
  webviewRef(mail)(page(calls));
  assert.ok(await until(() => calls.length > 0), "and Back runs on it once it arrived");
  assert.deepEqual(calls, ["back"]);
  webviews.delete(mail);
});

test("Back on a frozen copy is dropped for good if its pull-back is cancelled, even when the pin is selected again", async () => {
  const { a, b, mail } = twoWindows();
  webviewRef(mail)(page([]));
  S().activate(tileOf(b, "https://mail.com"));
  assert.ok(await until(() => S().tabs[mail].windowId === b));
  const frozen = S().windows[a].activeTabIds.default;
  const other = model.viewTabIds(S(), a).find((id) => !S().tabs[id].pinned);
  const calls = [];
  webviewRef(mail)(page(calls, 80));
  void withLivePage(frozen, (p) => p.goBack());
  S().activate(other);
  await new Promise((r) => setTimeout(r, 150));
  S().activate(frozen);
  assert.ok(await until(() => S().tabs[mail].windowId === a), "the later selection brings the page over");
  webviewRef(mail)(page(calls));
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(calls, [], "the cancelled Back never runs");
  webviews.delete(mail);
});
