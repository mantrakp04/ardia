import assert from "node:assert/strict";
import { test } from "node:test";
const { drainPassages } = await import("./translateDrain.ts");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const passage = (id, nodes = 1) => [id, Array.from({ length: nodes }, (_, i) => [id * 1000 + i, `text ${id}.${i}`])];
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakePage(batches) {
  const page = { applied: [], asked: [], inFlight: 0, maxInFlight: 0, holding: true, release: deferred() };
  page.port = {
    inFlight: 2,
    holds: () => page.holding,
    released: page.release.promise,
    next: async (max) => {
      page.asked.push(max);
      return batches.shift() ?? { passages: [], more: false, gone: false, done: 0, total: 0 };
    },
    translate: async ([, pieces]) => {
      page.inFlight++;
      page.maxInFlight = Math.max(page.maxInFlight, page.inFlight);
      await tick();
      page.inFlight--;
      return pieces.map(([id, text]) => [id, text.toUpperCase()]);
    },
    apply: async (results) => void page.applied.push(...results),
  };
  return page;
}

test("a block that comes back as more passages than asked for is translated whole, two at a time", async () => {
  const nine = Array.from({ length: 9 }, (_, i) => passage(i + 1, 40));
  const page = fakePage([{ passages: nine, more: false, gone: false, done: 9, total: 9 }]);
  assert.equal(await drainPassages(page.port), true);
  assert.equal(page.applied.length, 9 * 40);
  assert.ok(page.applied.some(([id, text]) => id === 9039 && text === "TEXT 9.39"));
  assert.equal(page.maxInFlight, 2);
  assert.ok(page.asked.every((max) => max >= 1 && max <= 2));
});

test("a request that fails after the translation was replaced never touches the page", async () => {
  const page = fakePage([{ passages: [passage(1)], more: false, gone: false, done: 1, total: 1 }]);
  const answer = deferred();
  page.port.translate = () => answer.promise;
  const drained = drainPassages(page.port);
  await tick();
  page.holding = false;
  page.release.resolve();
  answer.reject(new Error("the model went away"));
  assert.equal(await drained, false);
  await tick();
  assert.deepEqual(page.applied, []);
});

test("a late answer after the translation was replaced is dropped", async () => {
  const page = fakePage([{ passages: [passage(1)], more: false, gone: false, done: 1, total: 1 }]);
  const answer = deferred();
  page.port.translate = () => answer.promise;
  const drained = drainPassages(page.port);
  await tick();
  page.holding = false;
  page.release.resolve();
  assert.equal(await drained, false);
  answer.resolve([[1000, "late"]]);
  await tick();
  assert.deepEqual(page.applied, []);
});

test("a new document ends the drain at once, without waiting for the model", async () => {
  const page = fakePage([{ passages: [passage(1), passage(2)], more: true, gone: false, done: 2, total: 5 }]);
  page.port.translate = () => new Promise(() => {});
  const drained = drainPassages(page.port);
  await tick();
  page.holding = false;
  page.release.resolve();
  const outcome = await Promise.race([drained, new Promise((r) => setTimeout(() => r("still waiting"), 200))]);
  assert.equal(outcome, false);
});

test("a failed passage gives its pieces back and the drain reports the error", async () => {
  const page = fakePage([{ passages: [passage(1, 2)], more: false, gone: false, done: 1, total: 1 }]);
  page.port.translate = async () => {
    throw new Error("no model");
  };
  await assert.rejects(drainPassages(page.port), /no model/);
  assert.deepEqual(page.applied, [
    [1000, null],
    [1001, null],
  ]);
});

test("a failure recorded before the translation was replaced is dropped once the replacement starts", async () => {
  const page = fakePage([{ passages: [passage(1), passage(2)], more: false, gone: false, done: 2, total: 2 }]);
  const first = deferred();
  const second = deferred();
  const answers = [first, second];
  page.port.translate = () => answers.shift().promise;
  const drained = drainPassages(page.port);
  await tick();
  first.reject(new Error("the model went away"));
  await tick();
  await tick();
  page.holding = false;
  page.release.resolve();
  const outcome = await Promise.race([drained.then((v) => v, (e) => `threw ${e.message}`), new Promise((r) => setTimeout(() => r("still waiting"), 200))]);
  assert.equal(outcome, false);
  second.resolve([[2000, "late"]]);
  await tick();
  assert.deepEqual(page.applied, [[1000, null]]);
});

test("an answer whose apply finishes after the translation was released reports no progress", async () => {
  const page = fakePage([{ passages: [passage(1)], more: false, gone: false, done: 1, total: 1 }]);
  const applying = deferred();
  const progress = [];
  page.port.apply = async (results) => {
    page.applied.push(...results);
    await applying.promise;
  };
  page.port.onApplied = (total) => progress.push(total);
  const drained = drainPassages(page.port);
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(page.applied.length, 1);
  page.holding = false;
  page.release.resolve();
  applying.resolve();
  assert.equal(await drained, false);
  await tick();
  assert.deepEqual(progress, []);
});
