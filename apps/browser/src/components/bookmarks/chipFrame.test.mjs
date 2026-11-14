import assert from "node:assert/strict";
import { test } from "node:test";
const { chipFrame } = await import("./chipFrame.ts");
const { barSizes, bookmarksBar } = await import("./tokens.ts");

for (const [name, size] of Object.entries(barSizes)) {
  test(`${name} bar: a chip with no title is at least as wide as the bar's items are tall, so icon-only bookmarks don't touch`, () => {
    const frame = chipFrame(size, { titled: false });
    assert.equal(frame.minWidth, size.item);
    assert.equal(frame.width, undefined);
    assert.ok(frame.minWidth > size.favicon);
    assert.ok(frame.minWidth > size.iconBox);
  });

  test(`${name} bar: a titled chip keeps its padding and takes its width from its content`, () => {
    const frame = chipFrame(size, { titled: true });
    assert.equal(frame.paddingHorizontal, size.padding);
    assert.equal(frame.minWidth, undefined);
    assert.equal(frame.width, undefined);
  });

  test(`${name} bar: a chip given a width, like the overflow button, keeps exactly that width`, () => {
    const frame = chipFrame(size, { titled: false, width: bookmarksBar.overflowWidth });
    assert.equal(frame.width, bookmarksBar.overflowWidth);
    assert.equal(frame.minWidth, undefined);
  });
}
