import assert from "node:assert/strict";
import { test } from "node:test";

const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const rules = await import("./rules.ts");
const sources = await import("./sourceApps.ts");
const store = await import("./store.ts");
const { previewLink } = await import("./preview.ts");
const { decideLink, traceLink } = await import("../automation/decisions.ts");
const { reloadHooks } = await import("../automation/hookRules.ts");
const { approveRule, resetApprovalsForTests } = await import("../automation/approvals.ts");
const { approvalFor } = await import("../automation/hookPolicy.ts");
const { useHookRules } = await import("../automation/hookRules.ts");
const { startDecideHooks } = await import("../automation/decideHooks.ts");
const { takeAirTrafficCounts, airTrafficSetting } = await import("../telemetry/airTrafficCounts.ts");
const { cleanProperties } = await import("../telemetry/sanitize.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const SLACK = { bundleId: "com.tinyspeck.slackmacgap", appName: "Slack" };
const MAIL = { bundleId: "com.apple.mail", appName: "Mail" };
const slackApp = { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" };

let next = 0;
const rule = (over = {}) => ({ id: `t${++next}`, enabled: true, from: null, when: { kind: "any" }, profileId: null, open: "tab", ...over });

function fresh({ rules: list = [], fallback = null, hooks = [] } = {}) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const work = S().createProfile({ name: "Work" });
  resetApprovalsForTests();
  stub.configFolder.files.set("hooks.json", JSON.stringify({ hooks }));
  reloadHooks();
  store.resetAirTrafficForTests({ rules: list.map((r) => (typeof r === "function" ? r(work) : r)), fallback: typeof fallback === "function" ? fallback(work) : fallback });
  takeAirTrafficCounts();
  return work;
}

const verdictOf = (v) => (v && "drop" in v ? "drop" : v ? `${v.profileId ?? "last"}:${v.open}` : null);

test("the first enabled rule that fits answers, and a disabled one is skipped", () => {
  const work = fresh({
    rules: [
      rule({ enabled: false, from: slackApp, open: "window" }),
      (w) => rule({ from: slackApp, profileId: w, open: "littleArdia" }),
      rule({ from: slackApp, open: "window" }),
    ],
  });
  assert.equal(verdictOf(decideLink("https://news.example/", SLACK)), `${work}:littleArdia`);
  assert.equal(decideLink("https://news.example/", MAIL), null);
  assert.deepEqual(takeAirTrafficCounts(), { air_traffic_rule_links: 1, air_traffic_fallback_links: 0 });
});

test("a site rule takes the host and its subdomains, never a lookalike", () => {
  const host = rules.siteHost("https://GitHub.com/ardia");
  assert.equal(host, "github.com");
  const work = fresh({ rules: [(w) => rule({ when: { kind: "site", host }, profileId: w })] });
  for (const url of ["https://github.com/", "https://gist.github.com/x", "http://a.b.github.com/"]) assert.equal(verdictOf(decideLink(url, MAIL)), `${work}:tab`, url);
  for (const url of ["https://evilgithub.com/", "https://github.com.evil.example/", "ftp://github.com/x"]) assert.equal(decideLink(url, MAIL), null, url);
  assert.equal(rules.siteHost("not a host"), null);
  assert.equal(rules.siteHost("*.docs.example.com/path"), "docs.example.com");
});

test("a pattern rule matches as a userscript match pattern", () => {
  fresh({ rules: [rule({ when: { kind: "pattern", pattern: "https://*.example.com/docs/*" }, open: "window" })] });
  assert.equal(verdictOf(decideLink("https://www.example.com/docs/a", null)), "last:window");
  assert.equal(decideLink("https://www.example.com/blog/a", null), null);
  assert.ok(rules.patternProblem("https://*.ex*ample.com/*"));
  assert.equal(rules.patternProblem("https://*.example.com/*"), null);
});

test("a rule whose profile was deleted or is private falls through to the next one", () => {
  const work = fresh({ rules: [(w) => rule({ profileId: w, open: "window" }), rule({ profileId: "incognito:1@default" }), rule({ open: "littleArdia" })] });
  S().deleteProfile(work);
  assert.equal(verdictOf(decideLink("https://a.example/", SLACK)), "last:littleArdia");
  assert.equal(traceLink("https://a.example/", SLACK).index, 2);
});

test("Settings rules run before hooks.json, which runs before the fallback", () => {
  const hooks = [{ name: "slack-drop", on: "link.opening", from: ["Slack"], drop: true }];
  const work = fresh({ rules: [rule({ from: slackApp, when: { kind: "site", host: "github.com" }, open: "window" })], fallback: (w) => ({ profileId: w, open: "tab" }), hooks });
  assert.equal(verdictOf(decideLink("https://github.com/x", SLACK)), "last:window");
  assert.equal(verdictOf(decideLink("https://news.example/", SLACK)), "drop");
  assert.equal(traceLink("https://news.example/", SLACK).by, "hook");
  assert.equal(verdictOf(decideLink("https://news.example/", MAIL)), `${work}:tab`);
  assert.deepEqual(takeAirTrafficCounts(), { air_traffic_rule_links: 1, air_traffic_fallback_links: 1 });
});

test("the fallback answers only links nothing else caught, and a fallback to a deleted profile is the usual routing", () => {
  const routed = [{ name: "mail-work", on: "link.opening", from: ["com.apple.mail"], route: { open: "littleArdia" } }];
  const work = fresh({ fallback: (w) => ({ profileId: w, open: "window" }), hooks: routed });
  assert.equal(verdictOf(decideLink("https://a.example/", MAIL)), `${work}:window`, "an unapproved route hook is off, so the fallback answers");
  approveRule(approvalFor(useHookRules.getState().hooks[0]).key);
  assert.equal(verdictOf(decideLink("https://a.example/", MAIL)), "last:littleArdia");
  assert.equal(verdictOf(decideLink("https://a.example/", SLACK)), `${work}:window`);
  S().deleteProfile(work);
  assert.equal(decideLink("https://a.example/", SLACK), null);
  assert.equal(traceLink("https://a.example/", SLACK).by, "usual");
});

test("a program hook that doesn't answer leaves the link to the fallback", async () => {
  fresh({ fallback: { profileId: null, open: "littleArdia" }, hooks: [{ name: "router", on: "link.opening", run: ["~/bin/route"] }] });
  approveRule(approvalFor(useHookRules.getState().hooks[0]).key);
  const trace = traceLink("https://a.example/", MAIL);
  assert.equal(trace.by, "program");
  assert.equal(trace.otherwise.by, "fallback");
  assert.equal(verdictOf(await decideLink("https://a.example/", MAIL)), "last:littleArdia");
});

test("the hold is on while an enabled rule or a fallback exists, and follows every change", () => {
  fresh();
  startDecideHooks();
  assert.equal(stub.systemSignals.holdsIncomingLinks, false);
  const id = store.addAirTrafficRule({ enabled: true, from: null, when: { kind: "any" }, profileId: null, open: "tab" });
  assert.equal(stub.systemSignals.holdsIncomingLinks, true);
  store.updateAirTrafficRule(id, { enabled: false });
  assert.equal(stub.systemSignals.holdsIncomingLinks, false);
  store.setAirTrafficFallback({ profileId: null, open: "window" });
  assert.equal(stub.systemSignals.holdsIncomingLinks, true);
  store.setAirTrafficFallback(null);
  assert.equal(stub.systemSignals.holdsIncomingLinks, false);
  store.updateAirTrafficRule(id, { enabled: true });
  assert.equal(stub.systemSignals.holdsIncomingLinks, true);
  store.removeAirTrafficRule(id);
  assert.equal(stub.systemSignals.holdsIncomingLinks, false);
});

test("Try a Link says what decideLink does, for every kind of answer", () => {
  const work = fresh({
    rules: [(w) => rule({ from: slackApp, when: { kind: "site", host: "github.com" }, profileId: w, open: "window" })],
    fallback: { profileId: null, open: "littleArdia" },
    hooks: [{ name: "ads", on: "link.opening", match: "https://ads.example/*", drop: true }],
  });
  S().updateSettings({ openLinksInLittleArdia: false });
  const cases = [
    ["github.com/ardia", SLACK, "rule"],
    ["https://ads.example/x", SLACK, "hook"],
    ["https://news.example/", MAIL, "fallback"],
  ];
  for (const [typed, source, by] of cases) {
    const preview = previewLink(typed, source);
    assert.ok(preview.ok);
    assert.equal(preview.trace.by, by, typed);
    const real = decideLink(preview.url, source);
    assert.deepEqual(preview.trace.verdict, real, typed);
  }
  const rulePreview = previewLink("github.com/ardia", SLACK);
  assert.deepEqual([rulePreview.profileName, rulePreview.open, rulePreview.usedLast], ["Work", "window", false]);
  assert.equal(previewLink("https://ads.example/x", SLACK).dropped, true);
  store.setAirTrafficFallback(null);
  const usual = previewLink("news.example", MAIL);
  assert.equal(usual.trace.by, "usual");
  assert.equal(decideLink(usual.url, MAIL), null);
  assert.deepEqual([usual.open, usual.usedLast], ["tab", true]);
  assert.equal(previewLink("not a link at all", null).ok, false);
  assert.ok(work);
});

test("Try a Link follows a tab.opening rewrite or cancel that runs before routing", () => {
  fresh({
    rules: [(w) => rule({ when: { kind: "site", host: "new.example" }, profileId: w, open: "window" })],
    fallback: { profileId: null, open: "tab" },
    hooks: [
      { name: "move", on: "tab.opening", rewrite: [{ match: "https://old.example/*", to: "https://new.example{path}" }] },
      { name: "block", on: "tab.opening", match: "https://blocked.example/*", cancel: true },
    ],
  });
  approveRule(approvalFor(useHookRules.getState().hooks.find((h) => h.name === "move")).key);
  const moved = previewLink("https://old.example/a", MAIL);
  assert.equal(moved.opening.by, "rewrite");
  assert.equal(moved.url, "https://new.example/a");
  assert.equal(moved.trace.by, "rule");
  assert.deepEqual(moved.trace.verdict, decideLink(moved.url, MAIL));
  const blocked = previewLink("https://blocked.example/", MAIL);
  assert.deepEqual([blocked.opening.by, blocked.dropped, blocked.trace], ["cancel", true, null]);
});

test("a rule change that can't be saved leaves the rules and the hold as they were", () => {
  fresh({ rules: [rule()] });
  const id = store.useAirTraffic.getState().config.rules[0].id;
  stub.docs.set = () => {
    throw new Error("disk full");
  };
  try {
    store.updateAirTrafficRule(id, { enabled: false });
  } finally {
    delete stub.docs.set;
  }
  assert.equal(store.useAirTraffic.getState().config.rules[0].enabled, true);
});

test("the saved rules read back, an unversioned file upgrades, and a newer or broken one reads as nothing", () => {
  const config = {
    rules: [rule({ from: slackApp, when: { kind: "site", host: "github.com" }, profileId: "p1", open: "window" }), rule({ enabled: false, when: { kind: "pattern", pattern: "https://*.example.com/*" } })],
    fallback: { profileId: null, open: "littleArdia" },
  };
  const json = rules.airTrafficJson(config);
  assert.equal(JSON.parse(json).version, rules.AIR_TRAFFIC_VERSION);
  assert.deepEqual(rules.parseAirTraffic(json), config);
  const unversioned = JSON.stringify({ rules: config.rules, fallback: config.fallback });
  assert.deepEqual(rules.parseAirTraffic(unversioned), config);
  assert.deepEqual(rules.parseAirTraffic(JSON.stringify({ ...JSON.parse(json), version: 99 })), rules.NO_AIR_TRAFFIC);
  assert.deepEqual(rules.parseAirTraffic("{ nope"), rules.NO_AIR_TRAFFIC);
  const mixed = { version: 1, rules: [config.rules[0], { ...config.rules[1], when: { kind: "site", host: "Not A Host" } }, { ...config.rules[0] }, { id: "x", enabled: true, from: null, when: { kind: "any" }, profileId: null, open: "split" }], fallback: { open: "tab" } };
  assert.deepEqual(rules.parseAirTraffic(JSON.stringify(mixed)), { rules: [config.rules[0]], fallback: null });
});

test("the store saves its rules to the data dir and reads them back after a restart", () => {
  fresh();
  const id = store.addAirTrafficRule({ enabled: true, from: slackApp, when: { kind: "any" }, profileId: null, open: "window" });
  store.addAirTrafficRule({ enabled: true, from: null, when: { kind: "any" }, profileId: null, open: "tab" });
  store.moveAirTrafficRule(id, 1);
  const saved = rules.parseAirTraffic(stub.docs.get(rules.AIR_TRAFFIC_DOC));
  assert.deepEqual(saved.rules.map((r) => r.open), ["tab", "window"]);
  store.useAirTraffic.setState({ loaded: false });
  store.loadAirTraffic();
  assert.deepEqual(store.useAirTraffic.getState().config, saved);
});

test("incoming links remember the last 20 distinct apps that sent them, and nothing else", () => {
  fresh();
  let list = [];
  for (let i = 0; i < 25; i++) list = sources.withRecentApp(list, { bundleId: `com.example.app${i}`, appName: `App ${i}` });
  assert.equal(list.length, sources.MAX_RECENT_APPS);
  assert.equal(list[0].name, "App 24");
  const again = sources.withRecentApp(list, { bundleId: "COM.EXAMPLE.APP10", appName: "App 10" });
  assert.equal(again[0].bundleId, "COM.EXAMPLE.APP10");
  assert.equal(again.length, sources.MAX_RECENT_APPS);
  assert.equal(new Set(again.map(sources.sourceAppKey)).size, again.length);
  assert.equal(sources.withRecentApp(again, null), again);
  assert.equal(sources.withRecentApp(again, { bundleId: null, appName: null }), again);
  store.noteLinkSource(SLACK);
  store.noteLinkSource(MAIL);
  store.noteLinkSource(SLACK);
  assert.deepEqual(sources.parseRecentApps(stub.docs.get(sources.LINK_SOURCES_DOC)), [slackApp, { bundleId: "com.apple.mail", name: "Mail" }]);
  const picks = sources.pickableApps(store.useAirTraffic.getState().recentApps, [{ bundleId: null, name: "Custom" }]);
  assert.deepEqual(picks.recent.map((a) => a.name), ["Slack", "Mail", "Custom"]);
  assert.ok(!picks.common.some((a) => a.name === "Slack" || a.name === "Mail"));
});

test("telemetry sends only how many rules are on and whether a fallback is set", () => {
  const snap = airTrafficSetting({ rules: [rule({ from: slackApp }), rule({ enabled: false }), rule()], fallback: { profileId: "p", open: "tab" } });
  assert.deepEqual(snap, { air_traffic_rules: "2", air_traffic_fallback: "true" });
  assert.deepEqual(cleanProperties(snap), snap);
  assert.deepEqual(airTrafficSetting(rules.NO_AIR_TRAFFIC), { air_traffic_rules: "0", air_traffic_fallback: "false" });
});

test("a link from another app lands where its rule says, before any tab exists", async () => {
  const { openExternalUrls } = await import("../littleArdia/actions.ts");
  const work = fresh({ rules: [(w) => rule({ from: slackApp, when: { kind: "site", host: "github.com" }, profileId: w, open: "tab" })] });
  startDecideHooks();
  S().updateSettings({ openLinksInLittleArdia: true });
  S().createWindow({ url: "https://a.example/" });
  openExternalUrls(["https://github.com/ardia"], undefined, SLACK);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const tab = Object.values(S().tabs).find((t) => t.url === "https://github.com/ardia");
  assert.equal(tab?.profileId, work);
  assert.notEqual(S().windows[tab.windowId].kind, "small");
  assert.equal(store.useAirTraffic.getState().recentApps[0].name, "Slack");
});
