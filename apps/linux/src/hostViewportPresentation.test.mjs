import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("./shims/web/HostWebView.tsx", import.meta.url), "utf8");
const start = source.indexOf("    let revision = 0;");
const end = source.indexOf("    return () => {", start);
const code = stripTypeScriptTypes(source.slice(start, end));
const toHost = new Function(`${stripTypeScriptTypes(source.slice(source.indexOf("const toHost =")))}; return toHost;`)();
const run = new Function("node", "tab", "latest", "watchTabViewport", "reportHostError", "hostOverlayBlocked", "refreshTabViewports", "Image", "Date", "toHost", "reportAppliedViewport", "useBrowser", code);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const viewport = { rect: { x: 190, y: 47, width: 1083, height: 846 }, visible: true, occlusions: [{ x: 192, y: 48, width: 264, height: 112, paintOutset: 32 }] };

function fixture(capture, decode = async () => {}, themeColor = null) {
  let report;
  const applied = [];
  let captures = 0;
  let clock = 0;
  const updates = [];
  const node = { style: {} };
  const current = { identity: { browserId: 1 }, command: () => capture(++captures), viewport: async (value) => updates.push(value), disposed: false };
  run(node, { current }, { current: { tabId: "tab_1" } }, (_node, _visible, callback) => {
    report = callback;
    return () => {};
  }, () => {}, () => false, () => {}, class { decode = decode; }, { now: () => clock }, toHost, (owner, value) => applied.push([owner, value]), { getState: () => ({ live: { tab_1: { themeColor } } }) });
  return { node, current, updates, applied, report: (value = viewport) => report(value), advance: (ms) => { clock += ms; }, captures: () => captures };
}

for (const failure of ["null", "reject", "decode"]) {
  test(`native viewport retries a ${failure} capture without exposing an unbacked hole`, async () => {
    let decodes = 0;
    const f = fixture(async (attempt) => {
      if (attempt === 1 && failure === "null") return null;
      if (attempt === 1 && failure === "reject") throw new Error("Capture failed");
      return "data:image/png;base64,test";
    }, async () => {
      if (++decodes === 1 && failure === "decode") throw new Error("Decode failed");
    });
    f.report();
    await settle();
    f.report();
    await settle();
    assert.equal(f.captures(), 1);
    assert.equal(f.updates.length, 0);
    assert.equal(f.node.style.backgroundImage, undefined);
    f.advance(250);
    f.report();
    await settle();
    assert.equal(f.captures(), 2);
    assert.deepEqual(f.updates, [viewport]);
    assert.ok(f.node.style.backgroundImage);
  });
}

test("native viewport waits for identity before deduplicating its first update", async () => {
  const f = fixture(async () => null);
  const clear = { rect: viewport.rect, visible: true };
  f.current.identity = undefined;
  f.report(clear);
  await settle();
  assert.equal(f.updates.length, 0);
  f.current.identity = { browserId: 1 };
  f.report(clear);
  await settle();
  assert.deepEqual(f.updates, [clear]);
});

test("a late native snapshot cannot repaint a dismissed hover card", async () => {
  let resolve;
  const f = fixture(() => new Promise((done) => { resolve = done; }));
  f.report();
  await settle();
  const clear = { rect: viewport.rect, visible: true };
  f.report(clear);
  await settle();
  resolve("data:image/png;base64,test");
  await settle();
  assert.deepEqual(f.updates, [clear]);
  assert.equal(f.node.style.backgroundImage, "");
});

test("a menu over the page gets an exact hole at once and its shadow outset once the snapshot is painted", async () => {
  let resolve;
  const f = fixture(() => new Promise((done) => { resolve = done; }), async () => {}, "#22aa66");
  const menu = { x: 70, y: 87, width: 250, height: 428 };
  const open = { rect: viewport.rect, visible: true, occlusions: [{ ...menu, paintOutset: 40, menu: true }] };
  f.report(open);
  await settle();
  const exact = { rect: viewport.rect, visible: true, occlusions: [{ ...menu, paintOutset: 0 }] };
  assert.deepEqual(f.updates, [exact]);
  assert.equal(f.node.style.backgroundColor, "#22aa66");
  assert.deepEqual(f.applied, [[f.node, { ...open, occlusions: [{ ...menu, paintOutset: 0, menu: true }] }]]);
  resolve("data:image/png;base64,test");
  await settle();
  await settle();
  assert.deepEqual(f.updates, [exact, { rect: viewport.rect, visible: true, occlusions: [{ ...menu, paintOutset: 40 }] }]);
  assert.ok(f.node.style.backgroundImage);
  assert.deepEqual(f.applied.at(-1), [f.node, open]);
  const clear = { rect: viewport.rect, visible: true };
  f.report(clear);
  await settle();
  assert.deepEqual(f.updates.at(-1), clear);
  assert.equal(f.node.style.backgroundColor, "");
});
