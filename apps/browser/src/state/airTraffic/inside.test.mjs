import assert from "node:assert/strict";
import { test } from "node:test";

const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const store = await import("./store.ts");
const { placeInside, pageLinkRoutes } = await import("./inside.ts");
const { routeTypedUrl, isTypedSearch } = await import("./openAt.ts");
const { startPageRoutes } = await import("./pageRoutes.ts");
const { openFromPage } = await import("../tabs/openFromPage.ts");
const { openExternalUrls } = await import("../littleArdia/actions.ts");
const { setOpeningGate } = await import("../tabs/openingGate.ts");
const { takeAirTrafficCounts } = await import("../telemetry/airTrafficCounts.ts");
const { parseMatchPattern } = await import("../../lib/matchPattern.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const site = (host) => ({ kind: "site", host });

let next = 0;
const rule = (over = {}) => ({ id: `i${++next}`, enabled: true, from: null, when: { kind: "any" }, profileId: null, open: "tab", inside: true, ...over });

function fresh(rules = []) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], windows: {}, tabs: {} });
  const work = S().createProfile({ name: "Work" });
  const w = S().createWindow({ url: "https://page.example/" });
  const source = activeTabId(S(), w);
  store.resetAirTrafficForTests({ rules: rules.map((r) => (typeof r === "function" ? r(work) : r)), fallback: null });
  takeAirTrafficCounts();
  return { work, w, source, personal: S().tabs[source].profileId };
}

const tabsAt = (url) => Object.values(S().tabs).filter((t) => (t.page?.nav?.url ?? t.url) === url);

test("pages get the enabled any-app rules that also take Ardia's links, in order, with usable targets only", () => {
  const { work } = fresh([
    (w) => rule({ when: site("work.example"), profileId: w }),
    rule({ when: { kind: "pattern", pattern: "https://*.docs.example/*" }, open: "littleArdia" }),
    rule({ when: site("off.example"), enabled: false }),
    rule({ when: site("apps.example"), inside: false }),
    rule({ when: site("gone.example"), profileId: "gone" }),
    (w) => rule({ when: site("closed.example"), profileId: w, groupKey: "closed" }),
    rule({ open: "window" }),
  ]);
  assert.deepEqual(pageLinkRoutes(S(), store.currentAirTraffic()), [
    { spec: parseMatchPattern("*://*.work.example/*"), profile: work, open: "tab", group: null },
    { spec: parseMatchPattern("https://*.docs.example/*"), profile: null, open: "littleArdia", group: null },
    { spec: "any", profile: null, open: "window", group: null },
  ]);
});

test("a link already where its rule sends it isn't placed: its own profile as a tab, its Little Ardia, its group, or a page the rule already covers", () => {
  const { work, w, source, personal } = fresh();
  const config = (r) => ({ rules: [rule({ when: site("work.example"), ...r })], fallback: null });
  const place = (r, from = { profileId: personal, windowId: w, tabId: source }) => placeInside(S(), config(r), "https://work.example/a", from);
  assert.deepEqual(place({ profileId: work }), { profileId: work, open: "tab", groupKey: null });
  assert.equal(place({}), null);
  assert.deepEqual(place({ open: "window" }), { profileId: personal, open: "window", groupKey: null });
  assert.equal(place({ open: "window" }, { profileId: personal, windowId: w, tabId: S().newTab(w, { url: "https://www.work.example/" }) }), null);
  const small = S().createWindow({ kind: "small", url: "https://chat.example/" });
  assert.equal(place({ open: "littleArdia" }, { profileId: personal, windowId: small, tabId: activeTabId(S(), small) }), null);
  assert.deepEqual(place({ open: "littleArdia" }), { profileId: personal, open: "littleArdia", groupKey: null });
  const group = S().groupTabs([source], { name: "Inbox" });
  const key = S().groups[group].pinKey ?? group;
  assert.equal(place({ profileId: personal, groupKey: key }), null);
  const outside = S().newTab(w, { url: "https://other.example/" });
  assert.deepEqual(place({ profileId: personal, groupKey: key }, { profileId: personal, windowId: w, tabId: outside }), { profileId: personal, open: "tab", groupKey: key });
  assert.equal(placeInside(S(), config({ open: "littleArdia" }), "https://work.example/a", { profileId: personal, windowId: w, tabId: source }, true), null, "⌘ or ⇧ turns it into a tab in its own profile");
  const priv = S().createWindow({ kind: "private", url: "https://p.example/" });
  assert.equal(place({ profileId: work }, { profileId: S().windows[priv].profileId, windowId: priv }), null);
});

test("a routed click opens at its rule's destination and leaves the page; ⌘ opens a background tab there; a link no rule takes opens as it would have", async () => {
  const { work, w, source } = fresh([(wk) => rule({ when: site("example.net"), profileId: wk })]);
  const page = { windowId: w, tabId: source, profileId: S().tabs[source].profileId };
  openFromPage({ url: "https://example.net/a", disposition: "foreground", opens: "page", userGesture: true, routed: true, keyed: false }, page);
  await tick();
  const [a] = tabsAt("https://example.net/a");
  assert.deepEqual([a?.profileId, S().tabs[source].url, S().tabs[source].page.nav?.url], [work, "https://page.example/", "https://page.example/"]);
  assert.equal(S().windows[a.windowId].activeTabIds[work], a.id);
  openFromPage({ url: "https://example.net/b", disposition: "background", opens: "tab", userGesture: true, routed: true, keyed: true }, page);
  await tick();
  const [b] = tabsAt("https://example.net/b");
  assert.equal(b?.profileId, work);
  assert.notEqual(S().windows[b.windowId].activeTabIds[work], b.id);
  openFromPage({ url: "https://plain.example/", disposition: "foreground", opens: "page", userGesture: true, routed: true, keyed: false }, page);
  await tick();
  assert.equal(S().tabs[source].page.nav?.url, "https://plain.example/");
  assert.deepEqual(takeAirTrafficCounts().air_traffic_click_links, 2);
});

test("a routed click already at its destination opens the way its keys say: ⌘⇧ a foreground tab, a plain click in place", async () => {
  const { w, source, personal } = fresh();
  const group = S().groupTabs([source]);
  store.resetAirTrafficForTests({ rules: [rule({ when: site("mail.example"), profileId: personal, groupKey: S().groups[group].pinKey ?? group })], fallback: null });
  const page = { windowId: w, tabId: source, profileId: personal };
  openFromPage({ url: "https://mail.example/tab", disposition: "foreground", opens: "tab", userGesture: true, routed: true, keyed: true }, page);
  await tick();
  assert.equal(S().tabs[source].url, "https://page.example/");
  assert.ok(tabsAt("https://mail.example/tab").some((t) => t.id !== source));
  openFromPage({ url: "https://mail.example/here", disposition: "foreground", opens: "page", userGesture: true, routed: true, keyed: false }, page);
  await tick();
  assert.equal(S().tabs[source].page.nav?.url, "https://mail.example/here");
});

test("a link from another app with a group rule joins the group's copy in the window shown last, and opens its collapsed group", async () => {
  const { work } = fresh();
  const first = S().createWindow({ url: "https://inbox.example/", profileId: work });
  const group = S().groupTabs([S().windows[first].tabIds.find((id) => S().tabs[id].profileId === work)], { name: "Inbox" });
  S().updateGroup(group, { collapsed: true });
  const key = S().groups[group].pinKey ?? group;
  store.resetAirTrafficForTests({ rules: [rule({ inside: false, when: site("mail.example"), profileId: work, groupKey: key })], fallback: null });
  const { startDecideHooks } = await import("../automation/decideHooks.ts");
  startDecideHooks();
  openExternalUrls(["https://mail.example/1"], undefined, { bundleId: "com.apple.mail", appName: "Mail" });
  await tick();
  const [tab] = tabsAt("https://mail.example/1");
  assert.ok(tab && S().groups[group].tabIds.includes(tab.id));
  assert.equal(S().groups[group].collapsed, false);
  assert.equal(takeAirTrafficCounts().air_traffic_group_links, 1);
  S().closeWindow(first);
  assert.ok(!Object.values(S().groups).some((g) => (g.pinKey ?? g.id) === key), "the pinned group is parked with its window");
  openExternalUrls(["https://mail.example/2"], undefined, { bundleId: "com.apple.mail", appName: "Mail" });
  await tick();
  const [again] = tabsAt("https://mail.example/2");
  const copy = Object.values(S().groups).find((g) => (g.pinKey ?? g.id) === key);
  assert.ok(again && copy?.tabIds.includes(again.id), "a parked pinned group comes back in a new window and takes the link");
});

test("typing an address a rule sends elsewhere opens it there and keeps the source tab; searches and unmatched addresses stay", async () => {
  const { work, w, source } = fresh([(wk) => rule({ when: site("example.net"), profileId: wk })]);
  assert.equal(routeTypedUrl("https://example.net/x", { windowId: w, tabId: source, disposition: "current" }), true);
  await tick();
  assert.deepEqual(tabsAt("https://example.net/x").map((t) => t.profileId), [work]);
  assert.equal(S().tabs[source].url, "https://page.example/");
  assert.equal(routeTypedUrl("https://plain.example/", { windowId: w, tabId: source, disposition: "current" }), false);
  assert.deepEqual([isTypedSearch("example.net/x"), isTypedSearch("how tall is everest"), isTypedSearch("?example.net")], [false, true, true]);
  assert.equal(takeAirTrafficCounts().air_traffic_typed_links, 1);
});

test("a typed address goes through tab.opening first with where it was typed: a cancel opens nothing, a rewrite is placed again", async () => {
  const { work, w, source, personal } = fresh([(wk) => rule({ when: site("example.net"), profileId: wk })]);
  const seen = [];
  setOpeningGate((url, context) => {
    seen.push([url, context.profileId, context.tabId, context.via]);
    if (url.startsWith("https://example.net/blocked")) return { cancel: true };
    if (url.startsWith("https://example.net/away")) return { url: "https://elsewhere.example/" };
    return null;
  });
  try {
    routeTypedUrl("https://example.net/blocked", { windowId: w, tabId: source, disposition: "current" });
    routeTypedUrl("https://example.net/away", { windowId: w, tabId: source, disposition: "current" });
    await tick();
    assert.deepEqual(seen.slice(0, 2), [
      ["https://example.net/blocked", personal, source, "typed"],
      ["https://example.net/away", personal, source, "typed"],
    ]);
    assert.equal(tabsAt("https://example.net/blocked").length, 0);
    assert.equal(S().tabs[source].page.nav?.url, "https://elsewhere.example/");
    assert.equal(Object.values(S().tabs).some((t) => t.profileId === work), false);
  } finally {
    setOpeningGate(null);
  }
});

test("routes reach pages again when a rule or a group changes, and ones the page bridge refuses are sent again later", async () => {
  const { work } = fresh([(wk) => rule({ when: site("example.net"), profileId: wk })]);
  stub.pageLinkRoutes.failNext = 2;
  startPageRoutes();
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(stub.pageLinkRoutes.failNext, 0);
  assert.deepEqual(stub.pageLinkRoutes.sent.at(-1).map((r) => r.profile), [work]);
  const sent = stub.pageLinkRoutes.sent.length;
  S().createWindow({ url: "https://x.example/" });
  assert.equal(stub.pageLinkRoutes.sent.length, sent, "a change that leaves the routes as they were sends nothing");
  store.addAirTrafficRule({ enabled: true, from: null, when: { kind: "any" }, profileId: null, open: "window", inside: true });
  assert.deepEqual(stub.pageLinkRoutes.sent.at(-1).map((r) => r.open), ["tab", "window"]);
  const ruleId = store.currentAirTraffic().rules[0].id;
  store.updateAirTrafficRule(ruleId, { groupKey: "later" });
  assert.deepEqual(stub.pageLinkRoutes.sent.at(-1).map((r) => r.open), ["window"]);
  const w = S().createWindow({ url: "https://later.example/", profileId: work });
  const group = S().groupTabs([S().windows[w].tabIds.find((id) => S().tabs[id].profileId === work)]);
  store.updateAirTrafficRule(ruleId, { groupKey: S().groups[group].pinKey ?? group });
  assert.deepEqual(stub.pageLinkRoutes.sent.at(-1).map((r) => r.group !== null), [true, false]);
  S().deleteGroup(group);
  assert.deepEqual(stub.pageLinkRoutes.sent.at(-1).map((r) => r.open), ["window"], "a deleted group takes its rule off the pages");
});
