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

test("every kind native sends into a frame has a page-script handler, and every handler has a sender", () => {
  const called = collect(chromiumView, /kind:@"([A-Za-z]+)"/g);
  const handled = collect([pageScript], /\bhandlers\.([A-Za-z]+) =/g);
  assert.deepEqual(sorted(handled), sorted(called));
});
