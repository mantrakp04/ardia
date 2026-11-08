import { test } from "node:test";
import assert from "node:assert/strict";
import { requireNativeModule } from "expo-modules-core";

const { setBlockingCategory, setFilterList, readContentBlocker, changeBlockingCategory } = await import("./contentBlocking.ts");

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

test("turning a category on when the blocker has no list for it fails and sends nothing", async () => {
  calls.length = 0;
  await assert.rejects(() => setBlockingCategory(state(false, []), "ads", true), /no ads filter list/i);
  await assert.rejects(() => setBlockingCategory(state(true, [list("easyprivacy", "trackers", true, true)]), "ads", true), /no ads filter list/i);
  assert.deepEqual(calls, []);
});

test("turning a category off when nothing in it is on changes nothing and is not an error", async () => {
  assert.deepEqual(await sent(() => setBlockingCategory(state(false, []), "ads", false)), []);
});

const answering = async (reply, run) => {
  const wrapped = native.call;
  native.call = (verb, profile, json) => (verb === "state" ? reply() : wrapped(verb, profile, json));
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    return { result: await run(), warnings };
  } finally {
    native.call = wrapped;
    console.warn = warn;
  }
};
const readyState = { ...state(true, [list("easylist", "ads", true, true)]), stats: { ready: true, enabled: true, networkFilters: 5, cosmeticFilters: 2 } };
const placeholder = (error) => ({ enabled: false, version: "1", lists: [], allowedHosts: [], stats: { ready: false, enabled: false, ...(error ? { error } : {}) } });

test("a blocker that answers is read as it is", async () => {
  const { result, warnings } = await answering(() => Promise.resolve(JSON.stringify(readyState)), readContentBlocker);
  assert.deepEqual(result, { state: readyState, problem: null });
  assert.deepEqual(warnings, []);
});

test("the placeholder the engine sends when the blocker can't be read is a problem with its reason, not a state", async () => {
  const { result, warnings } = await answering(() => Promise.resolve(JSON.stringify(placeholder("uBlock Origin didn't start"))), readContentBlocker);
  assert.deepEqual(result, { state: null, problem: "uBlock Origin didn't start" });
  assert.deepEqual(warnings, ["[engine] ad blocker unavailable: uBlock Origin didn't start"]);
});

test("a placeholder without a reason still says the blocker is unavailable", async () => {
  const { result } = await answering(() => Promise.resolve(JSON.stringify(placeholder())), readContentBlocker);
  assert.equal(result.state, null);
  assert.match(result.problem, /isn't available/);
});

test("a read that fails is a problem with the failure's text, and is logged", async () => {
  const { result, warnings } = await answering(() => Promise.reject(new Error("the engine isn't running")), readContentBlocker);
  assert.deepEqual(result, { state: null, problem: "the engine isn't running" });
  assert.deepEqual(warnings, ["[engine] ad blocker unavailable: the engine isn't running"]);
});

const rejecting = async (run) => {
  const wrapped = native.call;
  native.call = () => Promise.reject(Object.assign(new Error("uBlock Origin didn't answer"), { code: "ERR_ENGINE" }));
  const errors = [];
  const report = console.error;
  console.error = (...args) => errors.push(args[0]);
  try {
    return { result: await run(), errors };
  } finally {
    native.call = wrapped;
    console.error = report;
  }
};

test("a change the engine refuses answers with why and is reported as an error, not dropped", async () => {
  const s = state(false, [list("easylist", "ads", false, true)]);
  const { result, errors } = await rejecting(() => changeBlockingCategory(s, "ads", true));
  assert.equal(result, "Couldn't change content blocking. uBlock Origin didn't answer");
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.equal(errors[0].message, "uBlock Origin didn't answer");
});

test("a category the blocker has no list for answers with why and is reported", async () => {
  calls.length = 0;
  const errors = [];
  const report = console.error;
  console.error = (...args) => errors.push(args[0]);
  try {
    assert.match(await changeBlockingCategory(state(false, []), "ads", true), /^Couldn't change content blocking\. .*no ads filter list/i);
  } finally {
    console.error = report;
  }
  assert.equal(errors.length, 1);
  assert.deepEqual(calls, []);
});

test("a change that works answers nothing and reports nothing", async () => {
  const errors = [];
  const report = console.error;
  console.error = (...args) => errors.push(args[0]);
  try {
    const s = state(true, [list("easylist", "ads", true, true)]);
    assert.equal(await changeBlockingCategory(s, "ads", false), null);
  } finally {
    console.error = report;
  }
  assert.deepEqual(errors, []);
});

test("turning a list on while the blocker is off turns it on", async () => {
  const s = state(false, [list("easylist", "ads", false, true), list("fanboy-annoyance", "annoyances", false)]);
  assert.deepEqual(await sent(() => setFilterList(s, "fanboy-annoyance", true)), ["setListEnabled fanboy-annoyance true", "setEnabled true"]);
  assert.deepEqual(await sent(() => setBlockingCategory(s, "ads", true)), ["setListEnabled easylist true", "setEnabled true"]);
});
