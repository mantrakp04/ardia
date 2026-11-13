import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ios = new URL("../ios/", import.meta.url);
const native = (file) => readFileSync(new URL(file, ios), "utf8");
const files = (pattern) => readdirSync(ios).filter((f) => pattern.test(f));
const collect = (sources, regex) => new Set(sources.flatMap((text) => [...text.matchAll(regex)].map((m) => m[1])));
const sorted = (set) => [...set].sort();

const pageEvents = readFileSync(new URL("./pageEvents.ts", import.meta.url), "utf8");
const table = pageEvents.slice(pageEvents.indexOf("const PAGE_EVENTS = {"), pageEvents.indexOf("} as const"));
const PAGE_EVENTS = collect([table], /^ {2}on[A-Za-z]+: "([A-Za-z]+)",$/gm);

const chromiumView = files(/^ArdiaWebView.*\.mm$/).map(native);
const chromiumEmitters = files(/\.mm$/).map(native);
const webKitTab = files(/^WebKitTab.*\.swift$/).map(native);
const pageScript = native("page_script.js");
const messageReceivers = ["ArdiaWebView+PageMessages.mm", "ArdiaWebView+Peek.mm"].map(native);

test("the Chromium view emits every page event in PAGE_EVENTS, and nothing else", () => {
  assert.deepEqual(sorted(collect(chromiumEmitters, /\bemit:@"([A-Za-z]+)"\s+payload:/g)), sorted(PAGE_EVENTS));
});

test("the WebKit tab emits only page events in PAGE_EVENTS", () => {
  const emitted = collect(webKitTab, /(?<![.\w])emit\("([A-Za-z]+)"/g);
  assert.ok(emitted.size > 0);
  assert.deepEqual(sorted([...emitted].filter((name) => !PAGE_EVENTS.has(name))), []);
});

test("every kind the page script sends has a native receiver, and every receiver has a sender", () => {
  const sent = collect([pageScript], /\bsend\("([A-Za-z]+)"/g);
  const received = collect(messageReceivers, /kind isEqualToString:@"([A-Za-z]+)"/g);
  assert.deepEqual(sorted(received), sorted(sent));
});

// A popup window (Audible's cloud player, #958) has no prompt to offer WebKit. Its host used not to implement the page
// message callback, so a popup page's `drm` message went nowhere. It now only counts it.
const popupWindow = native("ArdiaPopupWindow.mm");
const popupReceiver = popupWindow.slice(popupWindow.indexOf("- (void)tab:(ArdiaCoreTab *)tab\n    didReceivePageMessage:"));
const popupReceiverBody = popupReceiver.slice(0, popupReceiver.indexOf("\n}\n"));

test("a popup window receives page messages and records only a protected-media refusal, by key-system family", () => {
  assert.match(popupWindow, /- \(void\)tab:\(ArdiaCoreTab \*\)tab\s+didReceivePageMessage:\(NSString \*\)kind\s+json:\(NSString \*\)json\s+frame:\(NSString \*\)frameId\s+main:\(BOOL\)main\s+origin:\(NSString \*\)verifiedOrigin \{/);
  assert.match(popupReceiverBody, /if \(!\[kind isEqualToString:@"drm"\]\) return;/);
  assert.deepEqual(sorted(collect([popupReceiverBody], /kind isEqualToString:@"([A-Za-z]+)"/g)), ["drm"]);
  assert.match(popupReceiverBody, /\[ArdiaEvents emit:@"engine\.popupProtectedMedia" data:@\{@"family" : family, @"listed" : @\(OnProtectedVideoSite\(tab\.url\)\)\}\]/);
});

test("the popup's log line names the key-system family and nothing else, and nothing is forwarded", () => {
  const logs = [...popupReceiverBody.matchAll(/NSLog\(([^;]*)\);/g)].map((m) => m[1]);
  assert.deepEqual(logs, ['@"[ardiacore] popup protected media refused: %@", family']);
  assert.deepEqual(popupReceiverBody.match(/tab\.url/g), ["tab.url"]);
  assert.doesNotMatch(popupReceiverBody, /title|HostOf|promptHost|_opener|@selector/);
  assert.doesNotMatch(popupReceiverBody, /(?<!\(NSString \*\))\b(verifiedOrigin|frameId)\b/);
  assert.doesNotMatch(popupReceiverBody, /@catch|@try/);
});

test("the popup's key-system families are the ones the page script sends `drm` for", () => {
  const scripted = pageScript.match(/const protectedSystem = \/\^com\\\.\(([^)]*)\)\//)?.[1].split("|");
  assert.deepEqual(scripted, ["widevine\\.alpha", "microsoft\\.playready", "apple\\.fps"]);
  const families = Object.fromEntries([...popupWindow.matchAll(/hasPrefix:@"([^"]+)"\]\) return @"([a-z]+)";/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(families, { "com.widevine.alpha": "widevine", "com.microsoft.playready": "playready", "com.apple.fps": "fairplay" });
  assert.match(popupWindow, /return @"other";/);
});

test("the popup's streaming-site list is PROTECTED_VIDEO_SITES, https only, subdomains included", () => {
  const engines = readFileSync(new URL("../../../apps/browser/src/state/engines/engines.ts", import.meta.url), "utf8");
  const sites = engines.slice(engines.indexOf("export const PROTECTED_VIDEO_SITES"), engines.indexOf("];", engines.indexOf("export const PROTECTED_VIDEO_SITES")));
  const listed = [...sites.matchAll(/^ {2}"([a-z0-9.]+)",$/gm)].map((m) => m[1]);
  assert.ok(listed.length > 0);
  const nativeList = popupWindow.slice(popupWindow.indexOf("BOOL OnProtectedVideoSite"), popupWindow.indexOf("return NO;\n}", popupWindow.indexOf("BOOL OnProtectedVideoSite")));
  assert.deepEqual(sorted(collect([nativeList.slice(nativeList.indexOf("@["), nativeList.indexOf("];"))], /@"([a-z0-9.]+)"/g)), sorted(listed));
  assert.match(nativeList, /scheme\.lowercaseString isEqualToString:@"https"/);
  assert.match(nativeList, /\[host isEqualToString:domain\] \|\| \[host hasSuffix:\[@"\." stringByAppendingString:domain\]\]/);
});

test("every kind native sends into a frame has a page-script handler, and every handler has a sender", () => {
  const called = collect(chromiumView, /kind:@"([A-Za-z]+)"/g);
  const handled = collect([pageScript], /\bhandlers\.([A-Za-z]+) =/g);
  assert.deepEqual(sorted(handled), sorted(called));
});
