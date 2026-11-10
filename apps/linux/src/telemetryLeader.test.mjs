import assert from "node:assert/strict";
import test from "node:test";
import { isRelayed, startTelemetryLeadership, TELEMETRY_LOCK } from "./telemetryLeader.ts";

const turn = () => new Promise(setImmediate);

function fakeLocks() {
  let holder = null;
  const waiting = [];
  const handOver = () => {
    holder = null;
    const next = waiting.shift();
    if (next) grant(next);
  };
  const grant = (callback) => {
    holder = callback;
    Promise.resolve(callback({ name: TELEMETRY_LOCK })).finally(() => holder === callback && handOver());
  };
  return {
    request(name, options, callback) {
      assert.equal(name, TELEMETRY_LOCK);
      if (typeof options === "function") {
        if (holder) waiting.push(options);
        else grant(options);
        return Promise.resolve();
      }
      if (holder) return Promise.resolve(callback(null));
      grant(callback);
      return Promise.resolve();
    },
    leaderClosed: handOver,
  };
}

function fakeBus() {
  const channels = new Set();
  const open = () => {
    const channel = {
      onmessage: null,
      postMessage(data) {
        for (const other of channels) if (other !== channel) queueMicrotask(() => other.onmessage?.({ data: structuredClone(data) }));
      },
    };
    channels.add(channel);
    return channel;
  };
  open.drop = (channel) => channels.delete(channel);
  return open;
}

let ids = 0;

function window({ locks, channel, candidate = true, lead = async () => {}, handle = async (op) => `${op}-done` }) {
  const delivered = [];
  const handled = [];
  const changes = [];
  let relay = null;
  const leadership = startTelemetryLeadership({
    candidate,
    locks,
    channel,
    relay: (next) => (relay = next),
    deliver: (message) => delivered.push(message),
    handle: (op) => (handled.push(op), handle(op)),
    lead,
    changed: () => changes.push("changed"),
    report: (error) => assert.fail(String(error)),
    newId: () => `id-${++ids}`,
  });
  const capture = (event) => relay ? relay({ kind: "capture", event, props: {}, options: {} }) : delivered.push({ kind: "capture", event, local: true });
  return { delivered, handled, changes, capture, leadership, channel, relaying: () => relay !== null };
}

test("the first window leads, keeps what it captured before leading, and records later captures itself", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  let release;
  const first = window({ locks, channel: bus(), lead: () => new Promise((resolve) => (release = resolve)) });
  first.capture("early");
  await turn();
  assert.equal(first.leadership.leading(), false);
  assert.deepEqual(first.delivered, []);
  release();
  await turn();
  assert.equal(first.leadership.leading(), true);
  assert.equal(first.relaying(), false);
  assert.deepEqual(first.delivered.map((m) => m.event), ["early"]);
  first.capture("late");
  assert.deepEqual(first.delivered.map((m) => m.event), ["early", "late"]);
});

test("other windows forward their events to the leader, and a utility window never leads", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const leader = window({ locks, channel: bus() });
  await turn();
  const follower = window({ locks, channel: bus() });
  const utility = window({ locks, channel: bus(), candidate: false });
  follower.capture("from-follower");
  utility.capture("from-settings");
  await turn();
  assert.equal(follower.leadership.leading(), false);
  assert.equal(utility.leadership.leading(), false);
  assert.deepEqual(leader.delivered.map((m) => m.event).sort(), ["from-follower", "from-settings"]);
  assert.deepEqual(follower.delivered, []);
});

test("messages that aren't relayed telemetry are ignored", () => {
  assert.equal(isRelayed({ kind: "capture", event: "x", props: {}, options: {} }), true);
  assert.equal(isRelayed({ kind: "log", level: "error", message: "m", attributes: {} }), true);
  assert.equal(isRelayed({ kind: "capture", event: 1, props: {}, options: {} }), false);
  assert.equal(isRelayed({ kind: "log", level: "info", message: "m", attributes: {} }), false);
  assert.equal(isRelayed("capture"), false);
});

test("without the Web Locks API a browser window leads on its own", async () => {
  const solo = window({ locks: undefined, channel: null });
  await turn();
  assert.equal(solo.leadership.leading(), true);
});

test("when the leading window closes, a waiting window takes over and records its own events", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  window({ locks, channel: bus() });
  await turn();
  let led = 0;
  const next = window({ locks, channel: bus(), lead: async () => void led++ });
  await turn();
  assert.equal(next.leadership.leading(), false);
  locks.leaderClosed();
  await turn();
  assert.equal(led, 1);
  assert.equal(next.leadership.leading(), true);
  next.capture("after-handover");
  assert.deepEqual(next.delivered.map((m) => m.event), ["after-handover"]);
});

test("an event sent while no window leads is resent to the next leader, once", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const first = window({ locks, channel: bus() });
  await turn();
  const next = window({ locks, channel: bus() });
  const other = window({ locks, channel: bus() });
  await turn();
  bus.drop(first.channel);
  other.capture("in-the-gap");
  await turn();
  assert.deepEqual(first.delivered, []);
  locks.leaderClosed();
  await turn();
  await turn();
  assert.equal(next.leadership.leading(), true);
  assert.deepEqual(next.delivered.map((m) => m.event), ["in-the-gap"]);
  other.capture("after");
  await turn();
  assert.deepEqual(next.delivered.map((m) => m.event), ["in-the-gap", "after"]);
});

test("a window that takes over records what it had sent but nobody confirmed", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const first = window({ locks, channel: bus() });
  await turn();
  const next = window({ locks, channel: bus() });
  await turn();
  bus.drop(first.channel);
  next.capture("unconfirmed");
  await turn();
  locks.leaderClosed();
  await turn();
  assert.deepEqual(next.delivered.map((m) => m.event), ["unconfirmed"]);
});

test("ending the session, reopening it and resetting the ID run in the leader, wherever they are asked", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const leader = window({ locks, channel: bus() });
  await turn();
  const settings = window({ locks, channel: bus(), candidate: false });
  assert.equal(await settings.leadership.request("reset", 1000), "reset-done");
  assert.equal(await settings.leadership.request("end", 1000), "end-done");
  assert.equal(await leader.leadership.request("reopen", 1000), "reopen-done");
  assert.deepEqual(leader.handled, ["reset", "end", "reopen"]);
  assert.deepEqual(settings.handled, []);
});

test("the leader's choice announcement reaches the other windows, and only a leader can announce", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const leader = window({ locks, channel: bus() });
  await turn();
  const settings = window({ locks, channel: bus(), candidate: false });
  const other = window({ locks, channel: bus(), candidate: false });
  await turn();
  settings.leadership.announce();
  await turn();
  assert.deepEqual([leader.changes, other.changes], [[], []]);
  leader.leadership.announce();
  await turn();
  assert.deepEqual([leader.changes, settings.changes, other.changes], [[], ["changed"], ["changed"]]);
});

test("an event captured before the lock decision reaches the leader once", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const leader = window({ locks, channel: bus() });
  await turn();
  const follower = window({ locks, channel: bus() });
  follower.capture("early");
  await turn();
  await turn();
  assert.deepEqual(leader.delivered.map((m) => m.event), ["early"]);
});

test("a request heard while the leader is still starting runs once, even when the asker repeats it after the announcement", async () => {
  const locks = fakeLocks();
  const bus = fakeBus();
  const first = window({ locks, channel: bus() });
  await turn();
  let release;
  const next = window({ locks, channel: bus(), lead: () => new Promise((resolve) => (release = resolve)) });
  const settings = window({ locks, channel: bus(), candidate: false });
  await turn();
  bus.drop(first.channel);
  locks.leaderClosed();
  await turn();
  const reset = settings.leadership.request("reset", 1000);
  await turn();
  release();
  assert.equal(await reset, "reset-done");
  await turn();
  await turn();
  assert.deepEqual(next.handled, ["reset"]);
});

test("a leader's own request has a deadline too", async () => {
  const solo = window({ locks: undefined, channel: null, handle: () => new Promise(() => {}) });
  await turn();
  await assert.rejects(solo.leadership.request("end", 20), { code: "ERR_TELEMETRY_OWNER" });
});

test("a request with no leader to answer it fails after its deadline", async () => {
  const bus = fakeBus();
  const settings = window({ locks: fakeLocks(), channel: bus(), candidate: false });
  await assert.rejects(settings.leadership.request("end", 20), { code: "ERR_TELEMETRY_OWNER" });
});
