import assert from "node:assert/strict";
import { test } from "node:test";
import { newTabToastRect } from "./newTabToastGeometry.ts";
import { visibleNewTabToasts } from "../../state/tabs/newTabToasts.ts";

const page = (rect = {}) => ({ x: 0, y: 0, width: 800, height: 600, containerWidth: 800, containerHeight: 600, ...rect });

test("toast bounds follow the actual page with DevTools docked on the right, left or bottom", () => {
  assert.deepEqual(newTabToastRect(page({ width: 500 }), 800, 600, true), { x: 0, y: 0, width: 500, height: 600 });
  assert.deepEqual(newTabToastRect(page({ x: 300, width: 500 }), 800, 600, true), { x: 300, y: 0, width: 500, height: 600 });
  assert.deepEqual(newTabToastRect(page({ height: 360 }), 800, 600, true), { x: 0, y: 0, width: 800, height: 360 });
  assert.deepEqual(newTabToastRect(page(), 800, 600, true), { x: 0, y: 0, width: 800, height: 600 });
});

test("native page bounds are clipped to the matching logical host and invalid or stale reports defer display", () => {
  assert.deepEqual(newTabToastRect(page({ x: -10, y: -20, width: 830, height: 650 }), 800, 600, true), { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(newTabToastRect(null, 800, 600, true), null);
  assert.equal(newTabToastRect(undefined, 800, 600, true), null);
  assert.equal(newTabToastRect(page(), 801, 600, true), null);
  assert.equal(newTabToastRect(page(), 800, 601, true), null);
  assert.ok(newTabToastRect(page(), 800.4, 600.4, true));
  for (const rect of [{ width: -1 }, { height: -1 }, { x: NaN }, { y: Infinity }, { width: Infinity }, { containerWidth: 0 }, { containerHeight: NaN }, { x: 900 }, { height: 0 }]) {
    assert.equal(newTabToastRect(page(rect), 800, 600, true), null, JSON.stringify(rect));
  }
  assert.equal(newTabToastRect(page(), 0, 600, true), null);
  assert.equal(newTabToastRect(page(), 800, NaN, false), null);
});

test("React New Tab and internal pages use their real host while unknown native geometry stays deferred", () => {
  assert.deepEqual(newTabToastRect(null, 640, 480, false), { x: 0, y: 0, width: 640, height: 480 });
  assert.deepEqual(newTabToastRect(page({ width: 200 }), 640, 480, false), { x: 0, y: 0, width: 640, height: 480 });
  assert.equal(newTabToastRect(page({ width: 200 }), 640, 480, true), null);
});

test("WebKit uses its full-size native host while Chromium waits for its current page rectangle", () => {
  assert.deepEqual(newTabToastRect(null, 640, 480, true, "webkit"), { x: 0, y: 0, width: 640, height: 480 });
  assert.deepEqual(newTabToastRect(page({ width: 200 }), 640, 480, true, "webkit"), { x: 0, y: 0, width: 640, height: 480 });
  assert.equal(newTabToastRect(null, 640, 480, true, "chromium"), null);
  assert.equal(newTabToastRect(page({ width: 200 }), 640, 480, true, "chromium"), null);
});

test("toast capacity uses the page rectangle rather than docked DevTools space", () => {
  const items = ["a", "b", "c"].map((tabId) => ({ tabId, windowId: "w", profileId: "p", appearedAt: null, leaving: false }));
  const narrow = newTabToastRect(page({ width: 190 }), 800, 600, true);
  assert.deepEqual(visibleNewTabToasts(items, "w", "p", narrow.height, false, narrow.width), []);
  const short = newTabToastRect(page({ height: 100 }), 800, 600, true);
  assert.deepEqual(visibleNewTabToasts(items, "w", "p", short.height, false, short.width).map((t) => t.tabId), ["a"]);
  assert.ok(items.every((t) => t.appearedAt === null));
});

test("page-layout reports are tab-scoped, cleared on detach and pruned with closed tabs", async () => {
  const { useBrowser } = await import("../../state/browser/store.ts");
  const { activeTabId } = await import("../../state/browser/model.ts");
  const { setPageLayout, usePages } = await import("../../state/tabs/pageState.ts");
  const S = () => useBrowser.getState();
  S().hydrate({});
  const w = S().createWindow({ url: "https://example.com/" });
  const a = activeTabId(S(), w);
  const b = S().newTab(w, { url: "https://example.org/", background: true });
  setPageLayout(a, page({ width: 500 }));
  setPageLayout(b, page({ height: 360 }));
  assert.equal(usePages.getState().pages[a].pageLayout.width, 500);
  assert.equal(usePages.getState().pages[b].pageLayout.height, 360);
  setPageLayout(a, null);
  assert.equal(newTabToastRect(usePages.getState().pages[a].pageLayout, 800, 600, true), null);
  S().closeTab(b);
  assert.equal(usePages.getState().pages[b], undefined);
  setPageLayout(b, null);
  assert.equal(usePages.getState().pages[b], undefined);
  setPageLayout(b, page());
  assert.equal(usePages.getState().pages[b], undefined);
  assert.equal(usePages.getState().pages[a].pageLayout, null);
});
