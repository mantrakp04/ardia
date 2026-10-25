import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../store/browser.ts");
const { arcSpacePages, importArcSpace, importFavicons, applyResult } = await import("./apply.ts");

const S = () => useBrowser.getState();

test("imported favicons use the destination engine profile and fragment-free page", async () => {
  S().hydrate({});
  const { engineProfile } = await import("../../store/model.ts");
  const calls = [];
  globalThis.acTestEngineCall = (...args) => { calls.push(args); return Promise.resolve({}); };
  try {
    const icons = [{ page: "https://a.test/#x", icon: "https://a.test/i.png", png: "AAAA" }];
    icons.push({ page: "https://other.test/", icon: "https://other.test/i.png", png: "AAAA" });
    const pages = ["https://a.test/#different"];
    const written = new Set();
    await importFavicons("default", icons, pages, written);
    assert.deepEqual(calls, [["ac_favicons_set", engineProfile("default"), { ...icons[0], page: "https://a.test/" }]]);
    await importFavicons("default", icons, pages, written);
    await importFavicons("incognito:default", icons, pages, written);
    await importFavicons("unknown", icons, pages, written);
    await importFavicons("default", [], pages, written);
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.acTestEngineCall;
  }
});

test("applyResult stores favicons before creating favorite tabs and survives individual failures", async () => {
  S().hydrate({});
  const url = "https://favorite.test/";
  const calls = [];
  globalThis.acTestEngineCall = (name, profile, args) => {
    if (name === "ac_favicons_set") {
      assert.equal(Object.values(S().tabs).some((t) => t.url === url), false);
      calls.push(args.page);
      if (calls.length === 1) return Promise.reject(new Error("unavailable"));
    }
    return Promise.resolve({});
  };
  try {
    await applyResult("default", {
      favicons: [{ page: "https://first.test/", icon: "https://first.test/i.png", png: "AAAA" }, { page: url, icon: `${url}i.png`, png: "AAAA" }],
      favorites: [{ url: "https://first.test/", title: "First", pinned: true }, { url, title: "Favorite", pinned: true }],
      tabs: [], spaces: [], history: [], credentials: [],
    }, "Chrome", []);
    assert.deepEqual(calls, ["https://first.test/", url]);
    const favorite = Object.values(S().tabs).find((t) => t.url === url);
    assert.equal(favorite.favicon, "https://favorite.test/favicon.ico");
  } finally {
    delete globalThis.acTestEngineCall;
  }
});

test("Arc rows, folder tabs and open tabs carry only their own origin favicon fallback", () => {
  S().hydrate({});
  S().createWindow();
  importArcSpace("default", {
    pinned: [
      { type: "url", title: "Row", url: "https://x.test/page" },
      { type: "url", title: "File", url: "file:///tmp/a.html" },
      { type: "folder", title: "Nested", children: [{ type: "folder", title: "Inner", children: [{ type: "url", title: "Child", url: "https://y.test/child" }] }] },
    ],
    tabs: [{ title: "Open", url: "http://open.test:8080/path", pinned: false }],
  });
  assert.equal(Object.values(S().tabs).find((t) => t.title === "Row").favicon, "https://x.test/favicon.ico");
  assert.equal(Object.values(S().tabs).find((t) => t.title === "Child").favicon, "https://y.test/favicon.ico");
  assert.equal(Object.values(S().tabs).find((t) => t.title === "File").favicon, null);
  assert.equal(Object.values(S().tabs).find((t) => t.title === "Open").favicon, "http://open.test:8080/favicon.ico");
});

test("applyResult filters pages by the tabs it imports and shares written keys", async () => {
  const favorite = "https://favorite.test/";
  const tab = "https://tab.test/";
  const unrelated = "https://unrelated.test/";
  const icons = [favorite, tab, unrelated].map((page) => ({ page, icon: `${page}i.png`, png: "AAAA" }));
  const calls = [];
  globalThis.acTestEngineCall = (name, profile, args) => {
    if (name === "ac_favicons_set") calls.push(args.page);
    return Promise.resolve({});
  };
  try {
    for (const spaces of [[{ pinned: [], tabs: [] }], []]) {
      S().hydrate({});
      calls.length = 0;
      const result = {
        favicons: icons,
        favorites: [{ url: favorite, title: "Favorite", pinned: true }],
        tabs: [{ url: tab, title: "Tab", pinned: false }],
        spaces, history: [], credentials: [],
      };
      const written = new Set();
      await applyResult("default", result, "Arc", [], undefined, written);
      assert.deepEqual(calls, spaces.length ? [favorite] : [favorite, tab]);
      calls.length = 0;
      await applyResult("default", result, "Arc", [], undefined, written);
      assert.deepEqual(calls, []);
    }
  } finally {
    delete globalThis.acTestEngineCall;
  }
});

test("arcSpacePages includes pinned links, nested folder links and open tabs", () => {
  assert.deepEqual(arcSpacePages({
    pinned: [
      { type: "url", title: "Pinned", url: "https://pinned.test/" },
      { type: "folder", title: "Folder", children: [{ type: "folder", title: "Nested", children: [{ type: "url", title: "Link", url: "https://nested.test/" }] }] },
    ],
    tabs: [{ url: "https://open.test/", title: "Open", pinned: false }],
  }), ["https://pinned.test/", "https://nested.test/", "https://open.test/"]);
});
