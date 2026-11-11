import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const focusState = read("../ios/ArdiaFocusState.mm");
const windowHost = read("../ios/ArdiaChromeWindowHost.mm");
const windowHostHeader = read("../ios/ArdiaChromeWindowHost.h");
const internal = read("../ios/ArdiaInternal.h");
const host = read("../ios/ArdiaHost.mm");
const handoff = read("../../shell/ios/FocusHandoff.swift");
const chromeWindows = read("../../shell/ios/ChromeWindows.swift");
const engine = "../../../engine/ardiacore/src/ardia/core/";
const engineHost = read(`${engine}ac_window_host.mm`);
const engineHostHeader = read(`${engine}ac_browser.h`);
const engineWindow = read(`${engine}ardiacore_window.mm`);
const enginePublic = read(`${engine}public/ArdiaCore.h`);

const body = (text, signature) => {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  assert.fail(`${signature} is not closed`);
};

test("the focus history keeps the last 40 changes", () => {
  assert.match(focusState, /constexpr NSUInteger kFocusHistoryLength = 40;/);
  assert.match(body(focusState, "void NoteFocusChange("), /history\.count > kFocusHistoryLength\) \[history removeObjectAtIndex:0\]/);
});

test("a profile switch is written to the focus history", () => {
  assert.match(body(focusState, "void NoteProfileSwitch("), /NoteFocusChange\(\[@"profile switch " stringByAppendingString:profile\.name \?: @"unknown"\], window\)/);
  assert.match(internal, /void NoteProfileSwitch\(ArdiaCoreProfile \*profile, NSWindow \*_Nullable window\);/);
  const show = body(windowHost, "+ (void)showProfile:");
  const setActive = show.indexOf("coreWindow.activeProfile = p;");
  const note = show.indexOf("ardia_host::NoteProfileSwitch(p, coreWindow.window);");
  assert.ok(setActive >= 0 && note > setActive, "showProfile notes the switch right after it sets the active profile");
});

test("Copy Diagnostics lists, per browser window, its number, the page's mouse-ignore result, the handoff state and the engine's active state", () => {
  const state = body(focusState, "NSString *FocusState()");
  assert.match(state, /if \(IsBrowserWindow\(window\)\) \[lines addObjectsFromArray:BrowserWindowLines\(window\)\]/);
  assert.ok(state.indexOf("BrowserWindowLines(window)") < state.indexOf("for (NSString *change in FocusHistory())"), "the lines come before the history");
  const lines = body(focusState, "NSArray<NSString *> *BrowserWindowLines(");
  assert.match(lines, /@"browser #%ld ", \(long\)window\.windowNumber/);
  assert.match(lines, /PageMoveResult\(window, WindowCentre\(window\), NO\)/);
  assert.match(lines, /@"page move at centre %@", move\.length \? move : @"no page view"/);
  assert.match(lines, /ArdiaChromeWindowHost\.focusHandoffSummaryHandler/);
  assert.match(lines, /handoff\(window\)/);
  assert.match(lines, /respondsToSelector:@selector\(activeSummary\)/);
  assert.match(lines, /core\.activeSummary componentsSeparatedByString:@"\\n"/);
  assert.match(lines, /@"engine %@"/);
});

test("the mouse-ignore test shares PageMoveAt's logic and sends no move", () => {
  const result = body(focusState, "NSString *PageMoveResult(");
  assert.match(result, /shouldIgnoreMouseEvent:/);
  assert.match(result, /if \(sendMove\) \[v mouseMoved:event\];/);
  assert.equal(body(focusState, "NSString *PageMoveAt(").trim(), "{\n  return PageMoveResult(window, point, YES);\n}");
  assert.equal([...focusState.matchAll(/PageMoveResult\(/g)].length, 3);
  assert.equal([...focusState.matchAll(/\[v mouseMoved:event\]/g)].length, 1);
});

test("a window's key epoch and paste gate are read from FocusHandoff without changing it, and reach Copy Diagnostics", () => {
  const summary = body(handoff, "func summary(of window: NSWindow) -> String");
  assert.match(summary, /epochs\[window\.windowNumber\] \?\? 0/);
  assert.match(summary, /gates\[ObjectIdentifier\(window\)\]/);
  assert.match(summary, /key epoch \\\(epoch\), no paste gate/);
  assert.match(summary, /paste gate \\\(state\), \\\(gate\.generations\.count\) generations, \\\(gate\.held\.count\) held/);
  assert.doesNotMatch(summary, /(epochs|gates)\[[^\]]*\]\s*(=|\+=)(?!=)/);
  assert.doesNotMatch(summary, /\.(append|insert|remove|end|note)\(/);
  assert.match(chromeWindows, /ArdiaChromeWindowHost\.focusHandoffSummaryHandler = \{ FocusHandoff\.shared\.summary\(of: \$0\) \}/);
  assert.match(windowHostHeader, /@property\(class, nonatomic, copy, nullable\) NSString \*\(\^focusHandoffSummaryHandler\)\(NSWindow \*window\);/);
  assert.match(windowHost, /gFocusHandoffSummary = \[handler copy\];/);
  assert.match(windowHost, /return gFocusHandoffSummary;/);
});

test("the engine's window host reports its active profile and, per browser, its active flag and whether it is the last active browser", () => {
  assert.match(engineHostHeader, /std::string ActiveSummary\(\) const;/);
  const summary = body(engineHost, "std::string WindowHost::ActiveSummary() const");
  assert.match(summary, /GlobalBrowserCollection::GetInstance\(\)->GetLastActiveBrowser\(\)/);
  assert.match(summary, /std::string\("profile "\)/);
  assert.match(summary, /active_profile_->GetBaseName\(\)\.value\(\)/);
  assert.match(summary, /": browser active "/);
  assert.match(summary, /BrowserActiveStateManager::From\(browser\.get\(\)\)->IsActive\(\)/);
  assert.match(summary, /", last active browser "/);
  assert.match(summary, /last_active == browser\.get\(\)/);
  assert.match(summary, /widget_->IsActive\(\)/);
  assert.doesNotMatch(summary, /GetTitle|GetURL|GetLastCommittedURL|GetVisibleURL/);
  assert.match(body(engineWindow, "- (NSString*)activeSummary"), /_host->ActiveSummary\(\)/);
  assert.match(enginePublic, /- \(NSString\*\)activeSummary;/);
});

test("engineInfo already returns the Focus block that Copy Diagnostics prints", () => {
  assert.match(host, /ardia_host::FocusState\(\)/);
});
