import assert from "node:assert/strict";
import { test } from "node:test";
const { translatePassage } = await import("./translate.ts");

const beforeAttributedText = () => {
  const calls = [];
  return {
    calls,
    translateBlocks: async (_source, _target, blocks, owner) => {
      calls.push({ blocks, owner });
      return blocks.map((pieces) => (pieces.length === 1 ? [pieces[0].toUpperCase()] : null));
    },
  };
};

test("before macOS 26.4 a styled passage is translated one piece per request, each node its own text", async () => {
  const model = beforeAttributedText();
  const progress = { unlinked: 0 };
  const out = await translatePassage(model, "en", "fr", [1, [[10, "Read the "], [11, "notes"]]], "tok", progress, () => true);
  assert.deepEqual(out, [
    [10, "READ THE "],
    [11, "NOTES"],
  ]);
  assert.equal(progress.unlinked, 1);
  assert.deepEqual(model.calls.map((c) => c.blocks), [[["Read the ", "notes"]], [["Read the "], ["notes"]]]);
  assert.ok(model.calls.every((c) => c.owner === "tok"));
});

test("a released translation doesn't fall back to more requests", async () => {
  const model = beforeAttributedText();
  const out = await translatePassage(model, "en", "fr", [1, [[10, "Read the "], [11, "notes"]]], "tok", { unlinked: 0 }, () => false);
  assert.deepEqual(out, [
    [10, null],
    [11, null],
  ]);
  assert.equal(model.calls.length, 1);
});

test("a model that answers nothing ends the translation with an error", async () => {
  const model = { translateBlocks: async (_s, _t, blocks) => blocks.map(() => null) };
  await assert.rejects(translatePassage(model, "en", "fr", [1, [[10, "Hello"]]], "tok", { unlinked: 0 }, () => true), /didn't answer/);
});
