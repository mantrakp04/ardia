import assert from "node:assert/strict";
import test from "node:test";
import { createWindowCloseBarrier } from "./utilityClose.ts";
import { createWindowCloseCoordinator } from "./windowCloseCoordinator.ts";

const request = { windowId: "settings", rendererGeneration: "9007199254740993", closeGeneration: "1" };
const main = { windowId: "main", rendererGeneration: "9007199254740993", closeGeneration: "1" };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("transport timeout leaves producers frozen until exact native cancellation event", async () => {
  const ack = deferred();
  const resumed = [];
  const close = createWindowCloseBarrier({ quiesce() {}, async drain() { return 7; }, acknowledge: () => ack.promise, async reject() { throw Object.assign(new Error("teardown continues"), { code: "ERR_WINDOW_CLOSE_IN_PROGRESS" }); }, resume: (value) => resumed.push(value) });
  const pending = close(request);
  await tick();
  ack.reject(new Error("transport timeout"));
  await assert.rejects(pending, { code: "ERR_WINDOW_CLOSE_IN_PROGRESS" });
  assert.equal(resumed.length, 0);
  assert.equal(close.cancelled({ ...request, closeGeneration: "2" }), false);
  assert.equal(close.cancelled({ ...request, rendererGeneration: 9007199254740993 }), false);
  assert.equal(close.cancelled(request), true);
  assert.equal(close.cancelled(request), true);
  assert.deepEqual(resumed, [request]);
});

test("duplicate old cancellation cannot resume producers quiesced for a newer attempt", async () => {
  let ack = deferred();
  const resumed = [];
  const close = createWindowCloseBarrier({ quiesce() {}, async drain() { return 0; }, acknowledge: () => ack.promise, async reject() { throw new Error("not confirmed"); }, resume: (value) => resumed.push(value.closeGeneration) });
  const first = close(request);
  await tick();
  close.cancelled(request);
  ack.reject(new Error("late old timeout"));
  await assert.rejects(first, /late old timeout/);
  ack = deferred();
  const next = { ...request, closeGeneration: "2" };
  void close(next).catch(() => {});
  await tick();
  close.cancelled(request);
  assert.deepEqual(resumed, ["1"]);
});

function harness(options = {}) {
  const log = [];
  const asks = [];
  const barrier = createWindowCloseBarrier({
    quiesce: (value) => log.push(["quiesce", value.closeGeneration]),
    drain: async () => { log.push(["drain"]); return 3; },
    acknowledge: options.acknowledge ?? (async (value, watermark) => { log.push(["acknowledge", value.closeGeneration, watermark, coordinator.departs(value)]); }),
    reject: async (value) => { log.push(["barrier-reject", value.closeGeneration]); },
    resume: (value) => { log.push(["resume", value.closeGeneration]); coordinator.producersResumed(value); },
  });
  const coordinator = createWindowCloseCoordinator({
    windowId: "main",
    utility: !!options.utility,
    decide: options.decide ?? ((windowId, reason, ask) => {
      log.push(["decide", windowId, reason]);
      return ask({ title: "Close 2 tabs?", windowId }).then(({ confirmed, suppressed }) => ({ decision: confirmed ? "allow" : "cancel", suppressWarning: suppressed }));
    }),
    ask: (options, signal) => {
      const answer = deferred();
      asks.push({ options, signal, answer });
      log.push(["ask"]);
      return answer.promise;
    },
    suppress: (reason) => log.push(["suppress", reason]),
    flush: async () => { log.push(["flush"]); },
    request: async () => main,
    beginDrain: async (value) => { log.push(["begin", value.closeGeneration]); return { accepted: true, endsSession: options.endsSession ?? true }; },
    reject: async (value) => { log.push(["reject", value.closeGeneration]); },
    barrier,
    cancelled: barrier.cancelled,
    suspendDialogs: options.suspend,
    resumeDialogs: options.resume,
    report: (error) => log.push(["report", error.message]),
  });
  return { log, asks, coordinator };
}
const steps = (log) => log.map(([step]) => step);

test("the warning is answered before producers quiesce, and allow drains, seals and acknowledges in order", async () => {
  const { log, asks, coordinator } = harness();
  const closing = coordinator.accept(main);
  await tick();
  assert.deepEqual(steps(log), ["decide", "ask"]);
  asks[0].answer.resolve({ confirmed: true, suppressed: true });
  await closing;
  assert.deepEqual(steps(log), ["decide", "ask", "suppress", "begin", "flush", "quiesce", "drain", "acknowledge"]);
  assert.deepEqual(log.at(-1), ["acknowledge", "1", 3, false]);
});

test("duplicate close events for one attempt show one warning and run one barrier", async () => {
  const { log, asks, coordinator } = harness();
  const first = coordinator.accept(main);
  const second = coordinator.accept({ ...main });
  const third = coordinator.close("window");
  assert.equal(first, second);
  await tick();
  assert.equal(asks.length, 1);
  asks[0].answer.resolve({ confirmed: true, suppressed: false });
  await Promise.all([first, second, third]);
  assert.deepEqual(steps(log).filter((step) => step !== "ask"), ["decide", "begin", "quiesce", "drain", "acknowledge"]);
});

test("native cancellation aborts and discards an open warning; its later answer never suppresses, drains or rejects", async () => {
  const { log, asks, coordinator } = harness();
  const closing = coordinator.accept(main);
  await tick();
  assert.equal(coordinator.cancelled({ ...main, closeGeneration: "2" }), false);
  assert.equal(asks[0].signal.aborted, false);
  assert.equal(coordinator.cancelled(main), true);
  assert.equal(asks[0].signal.aborted, true);
  await assert.rejects(closing, { code: "ERR_WINDOW_CLOSE_CANCELLED" });
  asks[0].answer.resolve({ confirmed: true, suppressed: true });
  await tick();
  assert.deepEqual(steps(log), ["decide", "ask"]);
});

test("Cancel or a failed warning rejects exactly that attempt without quiescing", async () => {
  const cancel = harness();
  const closing = cancel.coordinator.accept(main);
  await tick();
  cancel.asks[0].answer.resolve({ confirmed: false, suppressed: false });
  await assert.rejects(closing, { code: "ERR_WINDOW_CLOSE_CANCELLED" });
  assert.deepEqual(steps(cancel.log), ["decide", "ask", "reject"]);
  const failed = harness({ decide: async () => { throw new Error("Too many pending dialogs"); } });
  await assert.rejects(failed.coordinator.accept(main), /Too many pending dialogs/);
  assert.deepEqual(failed.log.filter(([step]) => step !== "report"), [["reject", "1"]]);
});

test("utility windows and app quit skip the tab warning but keep the drain and save barrier", async () => {
  for (const [options, context] of [[{ utility: true }, undefined], [{}, { quitting: true }]]) {
    const { log, asks, coordinator } = harness(options);
    await coordinator.accept(main, context);
    assert.equal(asks.length, 0);
    assert.deepEqual(steps(log), ["begin", "quiesce", "drain", "acknowledge"]);
  }
});

test("dialog suspension holds quiescence after allow and resumes once only on confirmed cancellation", async () => {
  const settled = deferred();
  const resumed = [];
  const token = Object.freeze({ settled: settled.promise });
  const { log, asks, coordinator } = harness({ suspend: () => token, resume: (value) => resumed.push(value), acknowledge: () => new Promise(() => {}) });
  const closing = coordinator.accept(main);
  await tick();
  asks[0].answer.resolve({ confirmed: true, suppressed: false });
  await tick();
  assert.deepEqual(steps(log), ["decide", "ask", "begin"]);
  settled.resolve();
  await tick(); await tick();
  assert.deepEqual(steps(log), ["decide", "ask", "begin", "quiesce", "drain"]);
  coordinator.cancelled(main);
  coordinator.cancelled(main);
  assert.deepEqual(resumed, [token]);
  void closing.catch(() => {});
});

test("only a close that does not end the session reports a departure, until it is cancelled", async () => {
  const ack = deferred();
  const leaving = harness({ endsSession: false, acknowledge: () => ack.promise });
  const closing = leaving.coordinator.accept(main);
  await tick();
  assert.equal(leaving.coordinator.departs(main), false);
  leaving.asks[0].answer.resolve({ confirmed: true, suppressed: false });
  await tick(); await tick();
  assert.equal(leaving.coordinator.departs(main), true);
  leaving.coordinator.cancelled(main);
  assert.equal(leaving.coordinator.departs(main), false);
  ack.reject(new Error("veto"));
  await assert.rejects(closing);
});
