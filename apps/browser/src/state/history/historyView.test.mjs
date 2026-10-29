import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { reloadHistory, startHistory } = await import("./engineSync.ts");
const { historyOf } = await import("./history.ts");
const { bookmarkRoots, isBookmarked } = await import("../bookmarks/bookmarks.ts");
const model = await import("../browser/model.ts");
const { firstWindowCommitted } = await import("../../lib/afterFirstWindow.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const view = () => historyOf(S(), "default").map((h) => `${h.url} ${h.title} ${h.visits}`);
const until = async (ok, what) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), what);
};

test("the view follows Chrome: a burst of visits, a retitle, a deletion, a clear, a relaunch", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const stop = startHistory();
  await reloadHistory();
  let updates = 0;
  const off = useBrowser.subscribe((s, prev) => void (s.history !== prev.history && updates++));

  const t0 = Date.now() - 60_000;
  stub.chromeVisit("", "https://b.com/", "B", t0);
  stub.chromeVisit("", "https://a.com/", "A", t0 + 1);
  stub.chromeVisit("", "https://a.com/", "A", t0 + 2);
  await tick();
  assert.deepEqual(view(), ["https://a.com/ A 2", "https://b.com/ B 1"], "created: shows");
  assert.equal(updates, 1, "one store update for the burst");

  stub.chromeHistoryEvent({ kind: "modified", profile: "", rows: [{ url: "https://b.com/", title: "B retitled", visits: 1 }] });
  await tick();
  assert.deepEqual(view(), ["https://a.com/ A 2", "https://b.com/ B retitled 1"], "updated: the new title shows");

  stub.chromeVisit("", "https://c.com/", "C", t0 + 3);
  stub.chromeHistoryEvent({ kind: "deleted", profile: "", all: false, urls: ["https://c.com/"] });
  await tick();
  assert.deepEqual(view(), ["https://a.com/ A 2", "https://b.com/ B retitled 1"], "visited then deleted in one event: gone");

  S().removeHistory("default", ["https://a.com/"]);
  assert.deepEqual(view(), ["https://b.com/ B retitled 1"], "deleted: gone from the view at once");
  await tick();
  assert.deepEqual(view(), ["https://b.com/ B retitled 1"], "and stays gone once Chrome's event lands");

  S().clearHistory("default");
  stub.chromeHistory("").clear();
  stub.chromeHistoryEvent({ kind: "deleted", profile: "", all: true, urls: [] });
  stub.chromeVisit("", "https://after.com/", "After");
  await until(() => view().length === 1, "the visit after the clear");
  assert.deepEqual(view(), ["https://after.com/ After 1"], "cleared, then the next visit only");

  await reloadHistory();
  assert.deepEqual(view(), ["https://after.com/ After 1"], "relaunch");
  off();
  stop();
});

test("a change that lands while the view is being read joins the read, in order", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  const stop = startHistory();
  const reading = reloadHistory();
  stub.chromeVisit("", "https://during.com/", "During");
  await reading;
  await tick();
  assert.deepEqual(view(), ["https://during.com/ During 1"]);
  stop();
});

const DAY = 86_400_000;
const legacy = (urls, now) =>
  JSON.stringify({ version: 2, history: { default: urls.map((url) => ({ url, title: url, favicon: null, visits: 2, lastVisit: now - 1000, visitTimes: [now - DAY, now - 1000] })) } });

test("history.json: a quit before the first window leaves it untouched for the next launch", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const now = Date.now();
  stub.docs.set("history.json", legacy(["https://old.com/"], now));
  const stop1 = startHistory();
  await new Promise((r) => setTimeout(r, 30));
  stop1();
  firstWindowCommitted();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(stub.docs.has("history.json"), "the file stays for the next launch");
  assert.equal(stub.chromeHistory("").size, 0, "nothing half-moved");
  assert.equal(S().history[""], undefined, "and no view read while it waited");
});

test("history.json: a quit right after the move keeps the file until Chrome has committed; moving again adds nothing twice", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const now = Date.now();
  stub.docs.set("history.json", legacy(["https://old.com/", "https://older.com/"], now));
  const stop1 = startHistory();
  await until(() => historyOf(S(), "default").length === 2, "moved and shown");
  stop1();
  assert.ok(stub.docs.has("history.json"), "kept a while after the move (Chrome commits a few seconds later)");
  const visits = () => [...stub.chromeHistory("").values()].map((r) => r.visits.length);
  assert.deepEqual(visits(), [2, 2]);
  S().hydrate({});
  const stop2 = startHistory();
  await until(() => historyOf(S(), "default").length === 2, "shown after the second launch");
  assert.deepEqual(visits(), [2, 2], "no visit doubled");
  assert.deepEqual(
    historyOf(S(), "default").map((h) => h.url).sort(),
    ["https://old.com/", "https://older.com/"],
  );
  stop2();
});

test("profiles that share data read one history and one tree in every state a listener hears, and each change is heard once", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const stop = startHistory();
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  await reloadHistory();
  const t = Date.now() - 60_000;
  let heard = 0;
  const disagreements = [];
  const off = useBrowser.subscribe((s) => {
    heard++;
    if (historyOf(s, a) !== historyOf(s, b)) disagreements.push(`history at ${heard}`);
    if (JSON.stringify(bookmarkRoots(s, a)) !== JSON.stringify(bookmarkRoots(s, b))) disagreements.push(`roots at ${heard}`);
    if (isBookmarked(s, a, "https://mark.example/") !== isBookmarked(s, b, "https://mark.example/")) disagreements.push(`bookmark at ${heard}`);
  });
  S().importHistory(b, [
    { url: "https://one.example/", title: "One", visits: 1, lastVisit: t },
    { url: "https://two.example/", title: "Two", visits: 1, lastVisit: t + 1000 },
  ]);
  assert.equal(heard, 1, "an import through B");
  S().removeHistory(a, ["https://one.example/"]);
  assert.equal(heard, 2, "a removal through A");
  assert.deepEqual(historyOf(S(), b).map((h) => h.url), ["https://two.example/"]);
  S().addBookmark({ profileId: b, url: "https://mark.example/", title: "Mark" });
  assert.equal(heard, 3, "a bookmark through B");
  assert.ok(isBookmarked(S(), a, "https://mark.example/"));
  await tick();
  const settled = heard;
  stub.chromeVisit(a, "https://three.example/", "Three", t + 2000);
  await tick();
  assert.equal(heard, settled + 1, "a visit Chrome reports for the shared engine");
  assert.deepEqual(historyOf(S(), b).map((h) => h.url), ["https://three.example/", "https://two.example/"]);
  S().clearHistory(b, t + 500);
  assert.equal(heard, settled + 2, "a clear through B");
  assert.deepEqual(historyOf(S(), a), []);
  assert.deepEqual(disagreements, []);
  off();
  stop();
});

test("a history read still running when the owner is deleted lands for the profile that still shares its data", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const stop = startHistory();
  await reloadHistory();
  const fake = stub.ardiaCoreNativeModules.ArdiaHistory;
  const call = fake.call;
  let release;
  const held = new Promise((r) => (release = r));
  let holding = 0;
  fake.call = (verb, profile, json) => (verb === "query" && profile !== "" ? (holding++, held.then(() => call(verb, profile, json))) : call(verb, profile, json));
  try {
    const a = S().createProfile({ name: "A" });
    const b = S().createProfile({ name: "B", shareWith: a });
    await until(() => holding > 0, "A's first read is held");
    stub.chromeHistory(a).set("https://pending.example/", { title: "Pending", visits: [Date.now() - 1000] });
    S().deleteProfile(a);
    assert.equal(model.engineProfile(S(), b), a, "B keeps A's engine");
    release();
    await until(() => historyOf(S(), b).length === 1, "the read lands");
    assert.deepEqual(historyOf(S(), b).map((h) => h.url), ["https://pending.example/"]);
  } finally {
    fake.call = call;
    stop();
  }
});

test("a history read that lands after the last profile on its engine is deleted doesn't bring the view back", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const stop = startHistory();
  await reloadHistory();
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  stub.chromeVisit(a, "https://late.example/", "Late");
  S().deleteProfile(b);
  S().deleteProfile(a);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(S().history[a], undefined);
  stop();
});
