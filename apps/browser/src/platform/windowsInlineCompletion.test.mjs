import assert from "node:assert/strict";
import { test } from "node:test";
import { windowsInlineCompletion } from "../../../../packages/expo-windows/src/inlineCompletion.ts";
import { noteInlineCompletionShown, takeInlineCompletionCounts } from "../state/telemetry/inlineCompletionCounts.ts";

const completing = (host) => windowsInlineCompletion(() => host).complete(7, "exa", "mple.com");

test("Windows shows the completion only when no IME composition is under way", async () => {
  assert.equal(await completing({ textComposing: async () => false }), 1);
  assert.equal(await completing({ textComposing: async () => true }), 0);
  assert.equal(await completing({ textComposing: () => Promise.reject(new Error("gone")) }), 0);
  assert.equal(await completing(null), 0);
});

test("inline completions shown are counted and reset once taken", () => {
  takeInlineCompletionCounts();
  noteInlineCompletionShown();
  noteInlineCompletionShown();
  assert.deepEqual(takeInlineCompletionCounts(), { command_bar_inline_completions: 2 });
  assert.deepEqual(takeInlineCompletionCounts(), { command_bar_inline_completions: 0 });
});
