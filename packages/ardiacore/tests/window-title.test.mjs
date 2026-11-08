import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const core = (file) => read(`../../../engine/ardiacore/src/ardia/core/${file}`);
const windowHost = core("ac_window_host.mm");
const windowHostTabs = core("ac_window_host_tabs.mm");
const windowHostClose = core("ac_window_host_close.mm");
const tabBridgeNavigation = core("ac_tab_bridge_navigation.mm");
const browserWindow = core("ac_browser_window.mm");
const browserWindowHeader = core("ac_browser_window.h");
const browserHeader = core("ac_browser.h");
const publicHeader = core("public/ArdiaCore.h");
const coreWindow = core("ardiacore_window.mm");
const trafficLights = read("../ios/ArdiaTrafficLights.mm");
const chromeWindowHost = read("../ios/ArdiaChromeWindowHost.mm");
const chromeWindowHostHeader = read("../ios/ArdiaChromeWindowHost.h");
const windowManager = read("../../shell/ios/WindowManager.swift");
const chromeWindows = read("../../shell/ios/ChromeWindows.swift");
const windowsModule = read("../../shell/ios/AppWindowsModule.swift");
const shellWindows = read("../../shell/src/windows.ts");
const popupWindow = read("../ios/ArdiaPopupWindow.mm");
const iosSources = readdirSync(new URL("../ios/", import.meta.url))
  .filter((name) => /\.(mm|m|swift)$/.test(name))
  .map((name) => [name, read(`../ios/${name}`)]);

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

test("a title that is only whitespace counts as blank", () => {
  const update = bodyOf(windowHost, "void WindowHost::UpdateTitle()");
  assert.match(update, /base::TrimWhitespace\(title, base::TRIM_ALL, &trimmed\)/);
  assert.match(update, /trimmed\.empty\(\) \? std::u16string\(kBrandTitle\)/);
  assert.doesNotMatch(update, /\btitle\.empty\(\) \? std::u16string\(kBrandTitle\)/);
});

test("the title follows the active tab, the shown profile and the page's own title", () => {
  assert.match(bodyOf(windowHostTabs, "void WindowHost::ActiveTabChanged("), /\bUpdateTitle\(\);/);
  assert.match(bodyOf(windowHost, "void WindowHost::SetActiveProfile("), /\bUpdateTitle\(\);/);
  const titleWasSet = bodyOf(tabBridgeNavigation, "void TabBridge::TitleWasSet(");
  assert.match(titleWasSet, /WindowHost::ForContents\(web_contents\(\)\)/);
  assert.match(titleWasSet, /->UpdateTitle\(\);/);
});

test("removing a tab from the strip re-reads the title once the whole removal is done", () => {
  const changed = bodyOf(windowHostTabs, "void WindowHost::OnTabStripModelChanged(");
  const removal = changed.slice(changed.indexOf("TabStripModelChange::kRemoved"));
  assert.ok(removal.includes("didRemoveTab:bridge->tab()"), "the removal branch is found");
  assert.match(removal, /\n    UpdateTitle\(\);\n  \}$/);
  assert.ok(removal.lastIndexOf("UpdateTitle();") > removal.lastIndexOf("didRemoveTab:"));
});

test("closing the shown profile's browser re-reads the title once it is no longer the active one", () => {
  const destroyed = bodyOf(windowHostClose, "void WindowHost::BrowserWindowDestroyed(");
  const cleared = destroyed.indexOf("active_profile_ = nullptr;");
  const erased = destroyed.indexOf("browsers_.erase(it);");
  const refreshed = destroyed.indexOf("UpdateTitle();");
  assert.ok(cleared >= 0 && erased > cleared, "the active profile is cleared before its browser is erased");
  assert.ok(refreshed > erased, "UpdateTitle runs after the browser is gone");
});

test("Chrome's title bar hook refreshes the host's title", () => {
  assert.doesNotMatch(browserWindowHeader, /void UpdateTitleBar\(\) override \{\}/);
  assert.match(browserWindowHeader, /void UpdateTitleBar\(\) override;/);
  assert.match(bodyOf(browserWindow, "void ACBrowserWindow::UpdateTitleBar()"), /host_->UpdateTitle\(\);/);
});

test("a tab the engine does not show names the window through an override the app sends", () => {
  assert.match(browserHeader, /void SetTitleOverride\(const std::u16string& title\);/);
  assert.match(browserHeader, /std::u16string title_override_;/);
  const update = bodyOf(windowHost, "void WindowHost::UpdateTitle()");
  assert.match(update, /std::u16string title = title_override_;/);
  assert.match(update, /if \(title\.empty\(\)\) \{/);
  const set = bodyOf(windowHost, "void WindowHost::SetTitleOverride(");
  assert.match(set, /title_override_ = title;/);
  assert.match(set, /UpdateTitle\(\);/);
  assert.match(publicHeader, /- \(void\)setTitleOverride:\(nullable NSString\*\)title;/);
  assert.match(bodyOf(coreWindow, "- (void)setTitleOverride:"), /_host->SetTitleOverride\(base::SysNSStringToUTF16\(title\)\);/);
  assert.match(chromeWindowHostHeader, /\+ \(void\)setTitleOverride:\(nullable NSString \*\)title inWindow:\(NSWindow \*\)window;/);
  assert.match(bodyOf(chromeWindowHost, "+ (void)setTitleOverride:"), /\[\[ArdiaWindowController forNSWindow:window\]\.coreWindow setTitleOverride:title\]/);
  assert.match(bodyOf(chromeWindows, "static func setTitleOverride(", "\n  }\n"), /ArdiaChromeWindowHost\.setTitleOverride\(title, in: window\)/);
  assert.match(windowsModule, /AsyncFunction\("setWindowTitleOverride"\)/);
  assert.match(shellWindows, /setWindowTitleOverride\(id: string, title: string \| null\): Promise<void>;/);
});

test("the shell keeps each window's override, applies it when the window is shown or swapped and drops it on close", () => {
  assert.match(windowManager, /private var titleOverrides: \[String: String\] = \[:\]/);
  assert.match(bodyOf(windowManager, "func setTitleOverride(id: String, title: String?)", "\n  }\n"), /titleOverrides\[id\] = title/);
  const show = bodyOf(windowManager, "private func show(", "\n  }\n");
  assert.match(show, /if entry\.hostsChrome \{\n\s+if let pinned = titleOverrides\[id\] \{ ChromeWindows\.setTitleOverride\(pinned, in: window\) \}\n/);
  const adopt = bodyOf(windowManager, "private func adopt(", "\n  }\n");
  assert.match(adopt, /if entry\.hostsChrome, let pinned = titleOverrides\[id\] \{ ChromeWindows\.setTitleOverride\(pinned, in: to\) \}/);
  assert.doesNotMatch(adopt, /\.title\s*=/);
  assert.match(bodyOf(windowManager, "private func forget(", "\n  }\n"), /titleOverrides\[entry\.id\] = nil/);
  assert.match(bodyOf(windowManager, "func close(id: String", "\n  }\n"), /titleOverrides\[id\] = nil/);
});

test("a popup window names itself through the engine's title override, not by writing the window title", () => {
  const update = bodyOf(popupWindow, "- (void)updateTitle {");
  assert.match(update, /\[_coreWindow setTitleOverride:/);
  assert.match(update, /PopupOriginText\(url\)/);
  assert.doesNotMatch(update, /\.title\s*=/);
});

test("nothing else in the app writes the title of a window the engine hosts", () => {
  const configure = bodyOf(trafficLights, "void ConfigureWindow(NSWindow *window)");
  assert.doesNotMatch(configure, /window\.title\s*=/);
  for (const [name, text] of iosSources) {
    assert.doesNotMatch(text, /[wW]indow\.title\s*=/, `${name} does not assign a window title`);
  }
  assert.match(bodyOf(windowManager, "func setTitle(id: String, title: String)", "\n  }\n"), /guard let entry = managed\[id\], !entry\.hostsChrome, /);
  const show = bodyOf(windowManager, "private func show(", "\n  }\n");
  const chromeBranch = show.slice(show.indexOf("if entry.hostsChrome {"), show.indexOf("} else {\n      window.title = title\n"));
  assert.ok(chromeBranch.startsWith("if entry.hostsChrome {"), "the hostsChrome branch is found");
  assert.doesNotMatch(chromeBranch, /\.title\s*=/);
  assert.match(show, /\} else \{\n\s+window\.title = title\n/);
});
