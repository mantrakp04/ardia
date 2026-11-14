import assert from "node:assert/strict";
import { test } from "node:test";
import { noteSelectionCopiedByKey, noteUrlCopied, takeUrlCopyCounts } from "./urlCopies.ts";

const none = { url_copies: 0, url_copies_while_pending: 0, selection_copy_keys: 0, selection_copy_key_tabs: 0, selection_copy_markdown: 0 };

test("address copies are counted, those taken before the first page apart, and taking them starts over", () => {
  noteUrlCopied(false);
  noteUrlCopied(true);
  noteUrlCopied(true);
  assert.deepEqual(takeUrlCopyCounts(), { ...none, url_copies: 3, url_copies_while_pending: 2 });
  assert.deepEqual(takeUrlCopyCounts(), none);
});

test("selection copies count the presses, the tabs they copied and the Markdown ones, and taking them starts over", () => {
  noteSelectionCopiedByKey(3, false);
  noteSelectionCopiedByKey(2, true);
  assert.deepEqual(takeUrlCopyCounts(), { ...none, selection_copy_keys: 2, selection_copy_key_tabs: 5, selection_copy_markdown: 1 });
  assert.deepEqual(takeUrlCopyCounts(), none);
});
