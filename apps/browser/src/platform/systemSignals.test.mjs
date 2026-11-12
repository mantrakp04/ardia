import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
await import("../test-native/index.ts");
const { emitSystemSignal, systemSignals } = await import("../test-native/shell.ts");
const { onSystemSleep, onSystemWake, onUserIdle } = await import("./systemSignals.ts");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("sleep and wake reach only their own listeners until unsubscribed", () => {
  const seen = [];
  const stopSleep = onSystemSleep(() => seen.push("sleep"));
  const stopWake = onSystemWake(() => seen.push("wake"));
  emitSystemSignal({ type: "sleep" });
  emitSystemSignal({ type: "wake" });
  stopSleep();
  stopSleep();
  emitSystemSignal({ type: "sleep" });
  emitSystemSignal({ type: "wake" });
  stopWake();
  emitSystemSignal({ type: "wake" });
  assert.deepEqual(seen, ["sleep", "wake", "wake"]);
});

test("idle thresholds are watched natively while someone listens, once per transition", async () => {
  const seen = [];
  const stopA = onUserIdle(2, (idle) => seen.push(["a", idle]));
  const stopB = onUserIdle(30, (idle) => seen.push(["b", idle]));
  assert.deepEqual(systemSignals.idleThresholds, [2, 30]);
  emitSystemSignal({ type: "idle", threshold: 2, idle: true });
  emitSystemSignal({ type: "idle", threshold: 2, idle: true });
  emitSystemSignal({ type: "idle", threshold: 7, idle: true });
  const stopLate = onUserIdle(2, (idle) => seen.push(["late", idle]));
  assert.deepEqual(systemSignals.idleThresholds, [2, 30]);
  await tick();
  emitSystemSignal({ type: "idle", threshold: 2, idle: false });
  stopA();
  stopLate();
  assert.deepEqual(systemSignals.idleThresholds, [30]);
  emitSystemSignal({ type: "idle", threshold: 2, idle: true });
  stopB();
  assert.deepEqual(systemSignals.idleThresholds, []);
  assert.deepEqual(seen, [["a", true], ["late", true], ["a", false], ["late", false]]);
});

test("an idle threshold must be a positive number of seconds", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => onUserIdle(bad, () => {}), RangeError);
});
