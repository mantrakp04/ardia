import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ios = new URL("../../ios/", import.meta.url);
const nativeFiles = readdirSync(ios).filter((f) => /\.(swift|mm)$/.test(f));
const native = (file) => readFileSync(new URL(file, ios), "utf8");

const api = src("./api.ts");
const typeBody = (name) => {
  const start = api.indexOf(`export type ${name} = {`);
  assert.ok(start >= 0, `${name} is in api.ts`);
  return api.slice(start, api.indexOf("\n};", start));
};
const keysOf = (body) => new Set([...body.matchAll(/^ {2}"([a-zA-Z]+\.[a-zA-Z]+)":/gm)].map((m) => m[1]));
const sorted = (set) => [...set].sort();

test("every call in api.ts has a handler in its domain's Swift call table, and nothing else does", () => {
  const swift = new Set();
  for (const file of nativeFiles.filter((f) => f.endsWith("Module.swift"))) {
    const text = native(file);
    const domain = text.match(/CallTable\(domain: "([a-zA-Z]+)"/)?.[1];
    if (!domain) continue;
    for (const [, verb] of text.matchAll(/^ {4}"([a-zA-Z]+)": /gm)) swift.add(`${domain}.${verb}`);
  }
  assert.deepEqual(sorted(swift), sorted(keysOf(typeBody("EngineCalls"))));
});

test("every event in api.ts is emitted natively under that name, and nothing else is", () => {
  const emitted = new Set();
  for (const file of nativeFiles) {
    for (const [, swift, objc] of native(file).matchAll(/ArdiaEvents\.emit\("([^"]+)"|ArdiaEvents emit:@"([^"]+)"/g)) emitted.add(swift ?? objc);
  }
  const bridge = native("ArdiaEngineBridge.mm");
  const between = (from, to) => bridge.slice(bridge.indexOf(from), bridge.indexOf(to, bridge.indexOf(from)));
  const renamed = new Map([...between("NSString *AppEventOfTopic(", "\n}").matchAll(/isEqualToString:@"([^"]+)"\] \? @"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  for (const [, topic] of between("ForwardedTopics()", "];").matchAll(/@"([^"]+)"/g)) emitted.add(renamed.get(topic) ?? topic);
  assert.deepEqual(sorted(emitted), sorted(keysOf(typeBody("EngineEvents"))));
});
