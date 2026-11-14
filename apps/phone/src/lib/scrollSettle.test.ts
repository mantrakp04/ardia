import assert from "node:assert/strict";
import test from "node:test";
import { scrollSaveDecision, type ScrollWatch } from "./scrollSettle.ts";

const run = (start: ScrollWatch, ys: number[]) => {
  let watch = start;
  const saves: number[] = [];
  for (const y of ys) {
    const step = scrollSaveDecision(watch, y);
    if (step.save) saves.push(y);
    watch = step.next;
  }
  return saves;
};

test("a scroll is saved once it has settled, and only when it moved since the last save", () => {
  assert.deepEqual(run({ lastSeen: null, lastSaved: 0 }, [0, 0, 0]), []);
  assert.deepEqual(run({ lastSeen: 0, lastSaved: 0 }, [300, 900, 900, 900]), [900]);
  assert.deepEqual(run({ lastSeen: 0, lastSaved: 0 }, [300, 300, 1200, 1200]), [300, 1200]);
  assert.deepEqual(run({ lastSeen: 500, lastSaved: 500 }, [501, 500]), []);
});
