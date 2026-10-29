import assert from "node:assert/strict";
import { test } from "node:test";
import { peekRegions, peekVerdict } from "../scenarios/d-sidebar.mjs";

function image(width, height, paint) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 3);
  return { width, height, data };
}

const PAGE = [0x22, 0xaa, 0x66];
const SIDEBAR = [232, 208, 212];
const SHELL = [240, 230, 232];
const regions = peekRegions({ x: 0, y: 0 }, { left: 7, top: 47 });

test("the peek verdict needs the sidebar over the left edge and the page painted beside it", () => {
  const peeked = image(800, 800, (x) => (x < 200 ? SIDEBAR : PAGE));
  assert.deepEqual(peekVerdict(peeked, regions), { peekShown: true, pageShown: true, peek: 0, beside: 1 });
  const blanked = image(800, 800, (x) => (x < 200 ? SIDEBAR : SHELL));
  assert.equal(peekVerdict(blanked, regions).pageShown, false);
  const closed = image(800, 800, () => PAGE);
  assert.equal(peekVerdict(closed, regions).peekShown, false);
});
