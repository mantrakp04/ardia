import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { S, entryKey, sceneLayout, mount, readDrag, tailKey } = await import("./fixtures/dragScene.mjs");
const { world, regionsOf } = await import("./fixtures/dragWorld.mjs");
const { sidebarMetrics } = await import("../../lib/sidebarMetrics.ts");

function listScene(percent) {
  const metrics = sidebarMetrics(percent);
  const W = world("a", "b", "c", "d");
  const L = sceneLayout({ top: 150, metrics });
  const listTop = L.y;
  L.row(W.id.a).row(W.id.b).row(W.id.c).row(W.id.d).tail("list");
  return { ...W, L, metrics, regions: regionsOf(L, { list: [listTop, L.y] }) };
}

const frameOf = (m, key) => m.L.entries.find((e) => e.key === key).frame;

for (const percent of [80, 100, 120]) {
  test(`at ${percent}%, a dragged row opens a gap of its own scaled pitch and drops where the pointer is`, async () => {
    const m = listScene(percent);
    const { c } = mount({ entries: m.L.entries, regions: m.regions, metrics: m.metrics });
    const d = frameOf(m, entryKey("tab", m.id.d));
    await c.begin(entryKey("tab", m.id.d), d.x + 20, d.y + 10);
    const b = frameOf(m, entryKey("tab", m.id.b));
    c.move(b.x + 20, b.y + 2);
    const drag = readDrag(c);
    c.end(true);
    assert.equal(drag.gapKey, entryKey("tab", m.id.b));
    assert.equal(drag.pitch, m.metrics.rowPitch);
    assert.deepEqual(S().windows[m.w].tabIds, [m.id.a, m.id.d, m.id.b, m.id.c]);
  });
}

test("at 80%, a list row dragged over smaller Top Apps opens a tile slot of the scaled pitch", async () => {
  const metrics = sidebarMetrics(80);
  const W = world("a", "b", "t1", "t2", "t3");
  const { id } = W;
  S().pinTabs([id.t1, id.t2, id.t3], true);
  const L = sceneLayout({ top: 60, metrics });
  const grid = L.tiles([id.t1, id.t2, id.t3]).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(id.a).row(id.b).tail("list");
  const regions = { tiles: grid, ...regionsOf(L, { list: [listTop, L.y] }) };
  const { c } = mount({ entries: L.entries, regions, metrics, viewport: { x: 0, y: listTop - 4, w: 200, h: 600 } });
  const a = L.entries.find((e) => e.key === entryKey("tab", id.a)).frame;
  await c.begin(entryKey("tab", id.a), a.x + 20, a.y + 10);
  c.move(grid.x + grid.w - 4, grid.y + metrics.tile.height / 2);
  const drag = readDrag(c);
  c.end(false);
  assert.equal(drag.marks.pins, true);
  assert.equal(drag.pitch, metrics.tile.slot);
  assert.equal(drag.gapKey, tailKey("tiles"));
});
