import assert from "node:assert/strict";
import { test } from "node:test";
import { noteUrlCopied, takeUrlCopyCounts } from "./urlCopies.ts";

test("address copies are counted, those taken before the first page apart, and taking them starts over", () => {
  noteUrlCopied(false);
  noteUrlCopied(true);
  noteUrlCopied(true);
  assert.deepEqual(takeUrlCopyCounts(), { url_copies: 3, url_copies_while_pending: 2 });
  assert.deepEqual(takeUrlCopyCounts(), { url_copies: 0, url_copies_while_pending: 0 });
});
