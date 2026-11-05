import { test } from "node:test";
import assert from "node:assert/strict";
import { requireNativeModule } from "expo-modules-core";

const { setBlockingCategory, setFilterList } = await import("./contentBlocking.ts");

const native = requireNativeModule("ArdiaContentBlocker");
const calls = [];
const call = native.call;
native.call = (verb, profile, json) => {
  calls.push([verb, JSON.parse(json)]);
  return call(verb, profile, json);
};
const sent = async (run) => {
  calls.length = 0;
  await run();
  return calls.map(([verb, args]) => `${verb} ${"id" in args ? `${args.id} ` : ""}${args.enabled}`);
};

const list = (id, category, enabled, defaultOn = false) => ({ id, category, enabled, defaultOn, title: id, filters: 1 });
const state = (enabled, lists) => ({ enabled, lists, allowedHosts: [], stats: {}, version: "1" });

test("turning off the last list in the sheet turns the blocker off, as the category toggle does", async () => {
  const s = state(true, [list("easylist", "ads", true, true), list("easyprivacy", "trackers", false, true)]);
  assert.deepEqual(await sent(() => setFilterList(s, "easylist", false)), ["setListEnabled easylist false", "setEnabled false"]);
  assert.deepEqual(await sent(() => setBlockingCategory(s, "ads", false)), ["setListEnabled easylist false", "setEnabled false"]);
});

test("a list left on keeps the blocker on", async () => {
  const s = state(true, [list("easylist", "ads", true, true), list("easyprivacy", "trackers", true, true)]);
  assert.deepEqual(await sent(() => setFilterList(s, "easylist", false)), ["setListEnabled easylist false"]);
});

test("turning a list on while the blocker is off turns it on", async () => {
  const s = state(false, [list("easylist", "ads", false, true), list("fanboy-annoyance", "annoyances", false)]);
  assert.deepEqual(await sent(() => setFilterList(s, "fanboy-annoyance", true)), ["setListEnabled fanboy-annoyance true", "setEnabled true"]);
  assert.deepEqual(await sent(() => setBlockingCategory(s, "ads", true)), ["setListEnabled easylist true", "setEnabled true"]);
});
