import assert from "node:assert/strict";
import { test } from "node:test";
import { peekRegions, peekTimeline, peekVerdict } from "../scenarios/d-sidebar.mjs";

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

test("the edge timeline tells a peek that slid back out from one that stayed, and how long dismissal took", () => {
  const steady = [[0, -1], [1000, -1], [1017, 36], [1050, 150], [1100, 195]];
  assert.deepEqual(peekTimeline(steady, 1000), { opened: true, rehid: false, closedAfter: 0 });
  const flicker = [[1000, -1], [1017, 37], [1100, 186], [1240, 76], [1330, 186], [1440, 59], [1550, -1]];
  assert.equal(peekTimeline(flicker, 1010).rehid, true);
  const never = [[1000, -1]];
  assert.deepEqual(peekTimeline(never, 1001), { opened: false, rehid: false, closedAfter: null });
  const dismissed = [[0, 195], [2000, 195], [2131, 120], [2290, -1]];
  assert.equal(peekTimeline(dismissed, 2000).closedAfter, 290);
});
