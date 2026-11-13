import assert from "node:assert/strict";
import { test, mock } from "node:test";
const { createSettler } = await import("./useSettled.ts");

function clocked(interval = 120) {
  mock.timers.enable({ apis: ["setTimeout"] });
  let at = 1000;
  const applied = [];
  const settler = createSettler((v) => applied.push(v), interval, () => at);
  return {
    applied,
    settler,
    advance(ms) {
      at += ms;
      mock.timers.tick(ms);
    },
  };
}

test("a lone change applies at once", (t) => {
  t.after(() => mock.timers.reset());
  const c = clocked();
  c.settler.push(1);
  assert.deepEqual(c.applied, [1]);
  c.advance(500);
  c.settler.push(2);
  assert.deepEqual(c.applied, [1, 2]);
});

test("a burst (a window being resized) applies at most once per interval and always ends on the last value", (t) => {
  t.after(() => mock.timers.reset());
  const c = clocked();
  for (let i = 1; i <= 60; i++) {
    c.settler.push(i);
    c.advance(8);
  }
  assert.ok(c.applied.length <= 6, `${c.applied.length} applies`);
  c.advance(200);
  assert.equal(c.applied.at(-1), 60);
  assert.equal(c.applied[0], 1);
});

test("an interval of 0 applies every change in order", (t) => {
  t.after(() => mock.timers.reset());
  const c = clocked(0);
  for (let i = 1; i <= 5; i++) {
    c.settler.push(i);
    c.advance(8);
  }
  assert.deepEqual(c.applied, [1, 2, 3, 4, 5]);
});

test("cancel drops a pending value", (t) => {
  t.after(() => mock.timers.reset());
  const c = clocked();
  c.settler.push(1);
  c.settler.push(2);
  c.settler.cancel();
  c.advance(500);
  assert.deepEqual(c.applied, [1]);
});
