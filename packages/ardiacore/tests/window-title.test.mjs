import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const core = (file) => read(`../../../engine/ardiacore/src/ardia/core/${file}`);
const windowHost = core("ac_window_host.mm");
const windowHostTabs = core("ac_window_host_tabs.mm");
const tabBridgeNavigation = core("ac_tab_bridge_navigation.mm");
const browserWindow = core("ac_browser_window.mm");
const browserWindowHeader = core("ac_browser_window.h");
const browserHeader = core("ac_browser.h");
const trafficLights = read("../ios/ArdiaTrafficLights.mm");
const windowManager = read("../../shell/ios/WindowManager.swift");

const bodyOf = (text, signature, close = "\n}\n") => {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} is defined`);
  const end = text.indexOf(close, start);
  assert.ok(end > start, `${signature} ends`);
  return text.slice(start, end);
};

test("the window host owns the window title and sets it through its widget delegate", () => {
  assert.match(browserHeader, /void UpdateTitle\(\);/);
  const update = bodyOf(windowHost, "void WindowHost::UpdateTitle()");
  assert.match(update, /ExistingBrowserFor\(active_profile_\)/);
  assert.match(update, /GetActiveWebContents\(\)/);
  assert.match(update, /->GetTitle\(\)/);
  assert.match(update, /widget_delegate_->SetTitle\(/);
  assert.match(update, /kBrandTitle/);
});

test("a blank tab title falls back to the brand name from one named constant", () => {
  assert.match(windowHost, /constexpr char16_t kBrandTitle\[\] = u"Ardia";/);
  assert.equal(windowHost.match(/u"Ardia"/g)?.length, 1);
  assert.doesNotMatch(windowHost, /SetTitle\(u"/);
});

test("the title follows the active tab, the shown profile and the page's own title", () => {
  assert.match(bodyOf(windowHostTabs, "void WindowHost::ActiveTabChanged("), /\bUpdateTitle\(\);/);
  assert.match(bodyOf(windowHost, "void WindowHost::SetActiveProfile("), /\bUpdateTitle\(\);/);
  const titleWasSet = bodyOf(tabBridgeNavigation, "void TabBridge::TitleWasSet(");
  assert.match(titleWasSet, /WindowHost::ForContents\(web_contents\(\)\)/);
  assert.match(titleWasSet, /->UpdateTitle\(\);/);
});

test("Chrome's title bar hook refreshes the host's title", () => {
  assert.doesNotMatch(browserWindowHeader, /void UpdateTitleBar\(\) override \{\}/);
  assert.match(browserWindowHeader, /void UpdateTitleBar\(\) override;/);
  assert.match(bodyOf(browserWindow, "void ACBrowserWindow::UpdateTitleBar()"), /host_->UpdateTitle\(\);/);
});

test("nothing else in the app writes the title of a window the engine hosts", () => {
  const configure = bodyOf(trafficLights, "void ConfigureWindow(NSWindow *window)");
  assert.doesNotMatch(configure, /window\.title\s*=/);
  assert.match(bodyOf(windowManager, "func setTitle(id: String, title: String)", "\n  }\n"), /hostsChrome/);
  assert.match(bodyOf(windowManager, "private func show(", "\n  }\n"), /if !entry\.hostsChrome \{ window\.title = title \}/);
});
