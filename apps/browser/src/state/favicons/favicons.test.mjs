import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;

const native = import.meta.resolve("../../platform/favicons.ts");
const stub = `export * from ${JSON.stringify(native)};
export const faviconsFor = (profile, pages) => globalThis.faviconsForTest(profile, pages);
export const storeFavicon = (...args) => (globalThis.storedFavicons.push(args), Promise.resolve({ stored: true }));`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "../../platform/favicons" && context.parentURL?.endsWith("/state/favicons/favicons.ts"))
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
const { adoptFavicons, faviconOutlived, resolveFavicon, useFavicon } = await import("./favicons.ts");
const { adoptIconPage, dropOutlivedFavicon, noteIconPage } = await import("./iconPage.ts");
const { useBrowser } = await import("../browser/store.ts");
const { engineProfile } = await import("../browser/model.ts");

const waitFor = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), "reached before the deadline");
};

test("an empty lookup that started before an import doesn't wipe the imported icon", async () => {
  useBrowser.getState().hydrate({});
  const page = "https://imported.test/";
  const lookups = [];
  globalThis.storedFavicons = [];
  globalThis.faviconsForTest = (profile, pages) => new Promise((resolve) => lookups.push({ pages, answer: () => resolve({ pages: new Map(), icons: new Map() }) }));
  const row = mount(() => useFavicon(page, null, "default"));
  try {
    await waitFor(() => lookups.some((l) => l.pages.includes(page)));
    adoptFavicons("default", [{ page, icon: `${page}favicon.png`, png: "AAAA" }]);
    assert.equal(resolveFavicon(page, null, "default")?.uri, "data:image/png;base64,AAAA");
    for (const l of lookups) l.answer();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(resolveFavicon(page, null, "default")?.uri, "data:image/png;base64,AAAA");
    await waitFor(() => globalThis.storedFavicons.length === 1);
    assert.deepEqual(globalThis.storedFavicons[0], [engineProfile("default"), page, `${page}favicon.png`, "AAAA"]);
  } finally {
    row.unmount();
    delete globalThis.faviconsForTest;
  }
});

test("a tab's icon outlives its page only once the tab has left the icon's site", () => {
  const netflix = "https://www.netflix.com/browse";
  assert.equal(faviconOutlived(netflix, "http://localhost:4321/"), true);
  assert.equal(faviconOutlived(netflix, "file:///Users/me/page.html"), true);
  assert.equal(faviconOutlived(netflix, "about:blank"), true);
  assert.equal(faviconOutlived(netflix, "https://www.netflix.com/title/80057281"), false);
  assert.equal(faviconOutlived(netflix, "https://WWW.netflix.com/browse#row"), false);
  assert.equal(faviconOutlived("http://localhost:4321/", "http://localhost:5173/"), true);
  assert.equal(faviconOutlived(null, "http://localhost:4321/"), false);
  assert.equal(faviconOutlived(netflix, ""), false);
});

test("an icon remembers its page across an engine switch, so the new engine's view still drops it on another site", () => {
  const S = () => useBrowser.getState();
  S().hydrate({});
  const netflix = "https://www.netflix.com/browse";
  const local = "http://localhost:4321/";
  const windowId = S().createWindow({ url: netflix });
  const tabId = S().windows[windowId].tabIds[0];
  S().updateTab(tabId, { url: netflix });
  adoptIconPage(tabId);
  S().updateTab(tabId, { favicon: "https://assets.nflxext.com/favicon.ico" });
  noteIconPage(tabId);
  S().navigated(tabId, { url: local, title: "" }, { isLoading: true });
  dropOutlivedFavicon(tabId, local, true);
  assert.equal(S().tabs[tabId].favicon, "https://assets.nflxext.com/favicon.ico");
  adoptIconPage(tabId);
  S().navigated(tabId, { url: local, title: "Local" }, { isLoading: false });
  dropOutlivedFavicon(tabId, local, false);
  assert.equal(S().tabs[tabId].favicon, null);
});

test("an icon stays when the tab finishes loading another page on the icon's site", () => {
  const S = () => useBrowser.getState();
  S().hydrate({});
  const page = "https://www.netflix.com/browse";
  const windowId = S().createWindow({ url: page });
  const tabId = S().windows[windowId].tabIds[0];
  S().updateTab(tabId, { url: page, favicon: "https://assets.nflxext.com/favicon.ico" });
  noteIconPage(tabId);
  S().navigated(tabId, { url: "https://www.netflix.com/title/1", title: "" }, { isLoading: false });
  dropOutlivedFavicon(tabId, "https://www.netflix.com/title/1", false);
  assert.equal(S().tabs[tabId].favicon, "https://assets.nflxext.com/favicon.ico");
});
