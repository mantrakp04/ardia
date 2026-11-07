import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const engine = (name) => readFileSync(new URL(`../../../engine/ardiacore/src/ardia/core/${name}`, import.meta.url), "utf8");
const host = (name) => readFileSync(new URL(`../ios/${name}`, import.meta.url), "utf8");

const bodyOf = (source, signature) => {
  const start = typeof signature === "string" ? source.indexOf(signature) : source.search(signature);
  assert.ok(start >= 0, `${signature} exists`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${signature} ends`);
  return source.slice(start, end);
};

test("the tab reports Chrome's recently-audible state, which holds for 2 s after the sound stops", () => {
  const tab = engine("ardiacore_tab.mm");
  const header = engine("public/ArdiaCore.h");
  const getter = bodyOf(tab, /- \(BOOL\)(?:recentlyAudible|audible) \{/);
  const helper = getter.indexOf("RecentlyAudibleHelper::FromWebContents");
  const held = getter.indexOf("WasRecentlyAudible()");
  const instant = getter.indexOf("IsCurrentlyAudible()");
  assert.ok(helper >= 0 && held > helper, "reads WasRecentlyAudible() from the contents' RecentlyAudibleHelper");
  assert.ok(instant > held, "falls back to the instant state only for contents without the helper");
  assert.doesNotMatch(header, /BOOL audible;/);
  assert.match(header, /@property\(readonly\) BOOL recentlyAudible;/);
  assert.match(tab, /#include "chrome\/browser\/ui\/recently_audible_helper.h"/);
});

test("the host's media event carries the recently-audible state", () => {
  const emit = bodyOf(host("ArdiaWebView+PageCommands.mm"), "- (void)emitMedia {");
  assert.doesNotMatch(emit, /_tab\.audible/);
  assert.match(emit, /_tab\.recentlyAudible/);
});

test("the bridge tells the host when the recently-audible state changes, including when the hold ends", () => {
  const bridge = engine("ac_tab_bridge.mm");
  const header = engine("ac_browser.h");
  const ensure = bodyOf(bridge, "void TabBridge::EnsureAudibleObserved() {");
  assert.match(ensure, /RecentlyAudibleHelper::FromWebContents\(web_contents\(\)\)/);
  assert.match(ensure, /audible_subscription_ = helper->RegisterRecentlyAudibleChangedCallback\(/);
  assert.match(ensure, /if \(audible_subscription_\) \{\s*return;\s*\}/);
  const changed = bodyOf(bridge, "void TabBridge::OnRecentlyAudibleChanged(bool was_recently_audible) {");
  assert.match(changed, /\[tab_ notify:@selector\(tabDidChangeAudio:\)\]/);
  assert.match(header, /base::CallbackListSubscription audible_subscription_;/);
  assert.match(header, /void EnsureAudibleObserved\(\);/);
  assert.match(header, /void OnRecentlyAudibleChanged\(bool was_recently_audible\);/);
});

test("an instant audio flip reaches the host only when no helper reports the held state", () => {
  const flip = bodyOf(engine("ac_tab_bridge.mm"), "void TabBridge::OnAudioStateChanged(bool audible) {");
  assert.match(flip, /if \(!audible_subscription_\) \{\s*\[tab_ notify:@selector\(tabDidChangeAudio:\)\];\s*\}/);
});

test("an instant audio flip subscribes to the helper before deciding, so the hold end is never missed", () => {
  const flip = bodyOf(engine("ac_tab_bridge.mm"), "void TabBridge::OnAudioStateChanged(bool audible) {");
  const ensure = flip.indexOf("EnsureAudibleObserved();");
  const decide = flip.indexOf("if (!audible_subscription_)");
  assert.ok(ensure >= 0, "the flip handler calls EnsureAudibleObserved()");
  assert.ok(decide > ensure, "the subscription is established before the handler decides whether to notify");
});

test("the subscription is made where the other tab helpers are observed and dropped with the contents", () => {
  const destroyed = bodyOf(engine("ac_tab_bridge.mm"), "void TabBridge::WebContentsDestroyed() {");
  assert.match(destroyed, /audible_subscription_\.reset\(\);/);
  assert.match(bodyOf(engine("ac_tab_bridge_navigation.mm"), "void TabBridge::DidFinishNavigation("), /EnsureAudibleObserved\(\);/);
  assert.match(bodyOf(engine("ac_window_host_tabs.mm"), "void WindowHost::OnTabStripModelChanged("), /bridge->EnsureAudibleObserved\(\);/);
});

test("the engine target depends on the helper it includes", () => {
  assert.match(engine("BUILD.gn"), /"\/\/chrome\/browser\/ui:recently_audible_helper",/);
});
