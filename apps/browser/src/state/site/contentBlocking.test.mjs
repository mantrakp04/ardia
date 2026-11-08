import { test } from "node:test";
import assert from "node:assert/strict";
import { requireNativeModule } from "expo-modules-core";

const { setBlockingCategory, setFilterList, readContentBlocker, changeBlockingCategory, changeFilterList, clearBlockingFailure, useBlockingFailure } = await import("./contentBlocking.ts");

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

const failure = () => useBlockingFailure.getState().message;
const quietly = async (run) => {
  const errors = [];
  const report = console.error;
  console.error = (...args) => errors.push(args[0]);
  try {
    await run();
  } finally {
    console.error = report;
  }
  return errors;
};

const liveBlocker = (lists, { enabled = false, refusing = null } = {}) => {
  const live = { enabled, lists };
  const wrapped = native.call;
  native.call = async (verb, profile, json) => {
    const args = JSON.parse(json);
    if (verb === "state" || verb === "setListEnabled" || verb === "setEnabled") calls.push([verb, args]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (verb === "state") return JSON.stringify({ ...live, allowedHosts: [], version: "1", stats: { ready: true } });
    if (verb === "setListEnabled") {
      if (args.id === refusing) throw new Error(`${args.id} didn't answer`);
      live.lists.find((l) => l.id === args.id).enabled = args.enabled;
      return "null";
    }
    if (verb === "setEnabled") {
      live.enabled = args.enabled;
      return "null";
    }
    return wrapped(verb, profile, json);
  };
  return { live, restore: () => (native.call = wrapped) };
};
const withBlocker = async (lists, options, run) => {
  const blocker = liveBlocker(lists, options);
  try {
    return await run(blocker.live);
  } finally {
    blocker.restore();
  }
};
const cookieLists = () => [list("fanboy-cookiemonster", "cookies", false, true), list("easylist-cookie", "cookies", false, true)];
const cookiesOn = (live) => live.lists.some((l) => l.category === "cookies" && l.enabled);

test("a change the engine refuses shows why and is reported as an error, not dropped", async () => {
  const { errors } = await rejecting(() => changeBlockingCategory("ads", true));
  assert.equal(failure(), "Couldn't change content blocking. uBlock Origin didn't answer");
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.equal(errors[0].message, "uBlock Origin didn't answer");
});

test("a list the engine refuses shows why, as a category does", async () => {
  await withBlocker([list("easylist", "ads", false, true)], { refusing: "easylist" }, async () => {
    const errors = await quietly(() => changeFilterList("easylist", true));
    assert.equal(failure(), "Couldn't change content blocking. easylist didn't answer");
    assert.equal(errors.length, 1);
  });
});

test("a category the blocker has no list for shows why and is reported", async () => {
  await withBlocker([], {}, async () => {
    calls.length = 0;
    const errors = await quietly(() => changeBlockingCategory("ads", true));
    assert.match(failure(), /^Couldn't change content blocking\. .*no ads filter list/i);
    assert.equal(errors.length, 1);
    assert.deepEqual(
      calls.filter(([verb]) => verb !== "state"),
      [],
    );
  });
});

test("a change made while the blocker can't be read shows its reason and sends nothing", async () => {
  const { result: errors } = await answering(() => Promise.resolve(JSON.stringify(placeholder("uBlock Origin didn't start"))), async () => {
    calls.length = 0;
    return quietly(() => changeBlockingCategory("ads", true));
  });
  assert.equal(failure(), "Couldn't change content blocking. uBlock Origin didn't start");
  assert.equal(errors.length, 1);
  assert.deepEqual(
    calls.filter(([verb]) => verb !== "state"),
    [],
  );
});

test("a change that works shows nothing and reports nothing", async () => {
  await withBlocker([list("easylist", "ads", true, true)], { enabled: true }, async (live) => {
    calls.length = 0;
    const errors = await quietly(() => changeBlockingCategory("ads", false));
    assert.equal(failure(), null);
    assert.deepEqual(errors, []);
    assert.equal(live.enabled, false);
    assert.deepEqual(
      calls.filter(([verb]) => verb !== "state").map(([verb, args]) => `${verb} ${"id" in args ? `${args.id} ` : ""}${args.enabled}`),
      ["setListEnabled easylist false", "setEnabled false"],
    );
  });
});

test("the next change clears the failure of the one before it", async () => {
  await withBlocker([list("easylist", "ads", true, true), list("easyprivacy", "trackers", true, true)], { enabled: true }, async () => {
    await quietly(() => changeBlockingCategory("cookies", true));
    assert.notEqual(failure(), null);
    await changeFilterList("easylist", false);
    assert.equal(failure(), null);
  });
});

const hanging = () => {
  const wrapped = native.call;
  let first = null;
  let n = 0;
  native.call = (verb, profile, json) => (n++ === 0 ? new Promise((_, reject) => (first = reject)) : wrapped(verb, profile, json));
  const failed = async (error) => {
    while (!first) await new Promise((resolve) => setTimeout(resolve, 1));
    first(error);
  };
  return { fail: failed, restore: () => (native.call = wrapped) };
};

test("a failure that lands after leaving the pane is not shown on return", async () => {
  const gate = hanging();
  try {
    await quietly(async () => {
      const pending = changeBlockingCategory("ads", true);
      clearBlockingFailure();
      await gate.fail(new Error("late failure"));
      await pending;
    });
    assert.equal(failure(), null);
  } finally {
    gate.restore();
  }
});

test("a change that fails keeps its failure when a different change works after it", async () => {
  await withBlocker([list("easylist", "ads", false, true)], {}, async () => {
    const gate = hanging();
    try {
      const errors = await quietly(async () => {
        const earlier = changeBlockingCategory("ads", true);
        const later = changeFilterList("easylist", true);
        await gate.fail(new Error("early failure"));
        await Promise.all([earlier, later]);
      });
      assert.equal(failure(), "Couldn't change content blocking. early failure");
      assert.equal(errors.length, 1);
    } finally {
      gate.restore();
    }
  });
});

test("the same change made again and working takes the failure of the first one away", async () => {
  await withBlocker([list("easylist", "ads", false, true)], {}, async (live) => {
    const gate = hanging();
    try {
      const errors = await quietly(async () => {
        const first = changeFilterList("easylist", true);
        const again = changeFilterList("easylist", true);
        await gate.fail(new Error("early failure"));
        await Promise.all([first, again]);
      });
      assert.equal(live.lists[0].enabled, true);
      assert.equal(failure(), null);
      assert.equal(errors.length, 1);
    } finally {
      gate.restore();
    }
  });
});

test("turning a list on while the blocker is off turns it on", async () => {
  const s = state(false, [list("easylist", "ads", false, true), list("fanboy-annoyance", "annoyances", false)]);
  assert.deepEqual(await sent(() => setFilterList(s, "fanboy-annoyance", true)), ["setListEnabled fanboy-annoyance true", "setEnabled true"]);
  assert.deepEqual(await sent(() => setBlockingCategory(s, "ads", true)), ["setListEnabled easylist true", "setEnabled true"]);
});

test("turning cookie banners on and straight off ends off, whatever the page last drew", async () => {
  await withBlocker(cookieLists(), {}, async (live) => {
    await Promise.all([changeBlockingCategory("cookies", true), changeBlockingCategory("cookies", false)]);
    assert.equal(cookiesOn(live), false);
    assert.equal(live.enabled, false);
    assert.equal(failure(), null);
  });
});

test("turning cookie banners off straight after an on that failed half way leaves them off and says why", async () => {
  await withBlocker(cookieLists(), { refusing: "easylist-cookie" }, async (live) => {
    const errors = await quietly(() => Promise.all([changeBlockingCategory("cookies", true), changeBlockingCategory("cookies", false)]));
    assert.equal(cookiesOn(live), false);
    assert.equal(live.enabled, false);
    assert.equal(failure(), "Couldn't change content blocking. easylist-cookie didn't answer");
    assert.equal(errors.length, 1);
  });
});
