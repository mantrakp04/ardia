import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.timers.enable({ apis: ["setTimeout"] });
const { CLI_DISCLOSURE_HOLD_MS, createCliDisclosure } = await import("./cliDisclosure.ts");

const make = () => {
  const changes = [];
  const disclosure = createCliDisclosure((shown) => changes.push(shown));
  return { disclosure, changes };
};

test("the first connection shows the pill at once", () => {
  const { disclosure, changes } = make();
  disclosure.update({ on: true, controlled: false });
  assert.deepEqual(changes, []);
  disclosure.update({ on: true, controlled: true });
  assert.deepEqual(changes, [true]);
  assert.equal(disclosure.shown, true);
  disclosure.dispose();
});

test("it stays for the hold after the last connection closes, then hides", () => {
  const { disclosure, changes } = make();
  disclosure.update({ on: true, controlled: true });
  disclosure.update({ on: true, controlled: false });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS - 1);
  assert.deepEqual(changes, [true]);
  mock.timers.tick(1);
  assert.deepEqual(changes, [true, false]);
  assert.equal(disclosure.shown, false);
});

test("a burst of short calls shows it once and hides it once", () => {
  const { disclosure, changes } = make();
  for (let call = 0; call < 25; call++) {
    disclosure.update({ on: true, controlled: true });
    mock.timers.tick(300);
    disclosure.update({ on: true, controlled: false });
    mock.timers.tick(700);
  }
  assert.deepEqual(changes, [true]);
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS);
  assert.deepEqual(changes, [true, false]);
});

test("a connection during the hold cancels the hide, and the hold restarts from the next drop", () => {
  const { disclosure, changes } = make();
  disclosure.update({ on: true, controlled: true });
  disclosure.update({ on: true, controlled: false });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS - 100);
  disclosure.update({ on: true, controlled: true });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS * 2);
  assert.deepEqual(changes, [true]);
  disclosure.update({ on: true, controlled: false });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS - 1);
  assert.deepEqual(changes, [true]);
  mock.timers.tick(1);
  assert.deepEqual(changes, [true, false]);
});

test("turning control off hides it at once, with no hold", () => {
  const { disclosure, changes } = make();
  disclosure.update({ on: true, controlled: true });
  disclosure.update({ on: false, controlled: false });
  assert.deepEqual(changes, [true, false]);
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS * 2);
  assert.deepEqual(changes, [true, false]);
});

test("turning control off during the hold hides it at once and drops the timer", () => {
  const { disclosure, changes } = make();
  disclosure.update({ on: true, controlled: true });
  disclosure.update({ on: true, controlled: false });
  mock.timers.tick(1000);
  disclosure.update({ on: false, controlled: false });
  assert.deepEqual(changes, [true, false]);
  disclosure.update({ on: true, controlled: true });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS * 2);
  assert.deepEqual(changes, [true, false, true]);
  disclosure.dispose();
});

test("dispose drops a pending hide", () => {
  const { disclosure, changes } = make();
  disclosure.update({ on: true, controlled: true });
  disclosure.update({ on: true, controlled: false });
  disclosure.dispose();
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS * 2);
  assert.deepEqual(changes, [true]);
});

const { createCliDisclosureStore } = await import("./cliDisclosure.ts");
const { createStore } = await import("zustand/vanilla");

const makeShared = () => {
  const source = createStore(() => ({ server: null }));
  const store = createCliDisclosureStore(source);
  const connect = (connections, state = "on") => source.setState({ server: { state, connections } });
  return { source, store, connect };
};

test("the shared store follows the server: shown at the first connection, held 3 s after the last", () => {
  const { store, connect } = makeShared();
  connect(0);
  assert.equal(store.getState().shown, false);
  connect(1);
  assert.equal(store.getState().shown, true);
  connect(0);
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS - 1);
  assert.equal(store.getState().shown, true);
  mock.timers.tick(1);
  assert.equal(store.getState().shown, false);
  store.dispose();
});

test("a reader that subscribes during the hold, as a remounted pill does, reads true and then sees the hide", () => {
  const { store, connect } = makeShared();
  const first = [];
  const unsubscribeFirst = store.subscribe((s) => first.push(s.shown));
  connect(2);
  connect(0);
  mock.timers.tick(1000);
  unsubscribeFirst();
  assert.deepEqual(first, [true]);
  const second = [];
  assert.equal(store.getState().shown, true);
  const unsubscribeSecond = store.subscribe((s) => second.push(s.shown));
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS - 1001);
  assert.deepEqual(second, []);
  assert.equal(store.getState().shown, true);
  mock.timers.tick(1);
  assert.deepEqual(second, [false]);
  unsubscribeSecond();
  store.dispose();
});

test("a store created while a connection is open starts shown", () => {
  const source = createStore(() => ({ server: { state: "on", connections: 1 } }));
  const store = createCliDisclosureStore(source);
  assert.equal(store.getState().shown, true);
  store.dispose();
});

test("the shared store hides at once when the server leaves on", () => {
  for (const state of ["off", "starting"]) {
    const { store, connect } = makeShared();
    connect(1);
    connect(0);
    mock.timers.tick(500);
    connect(0, state);
    assert.equal(store.getState().shown, false, state);
    store.dispose();
  }
});

test("dispose stops following the server", () => {
  const { store, connect } = makeShared();
  store.dispose();
  connect(1);
  assert.equal(store.getState().shown, false);
});
