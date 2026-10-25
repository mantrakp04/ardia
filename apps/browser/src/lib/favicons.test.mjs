import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../test-hooks.mjs";

globalThis.__DEV__ = false;

const native = new URL("../test-native-stub.mjs", import.meta.url).href;
const stub = `export * from ${JSON.stringify(native)};
export const faviconsFor = (profile, pages) => globalThis.faviconsForTest(profile, pages);
export const storeFavicon = (...args) => (globalThis.storedFavicons.push(args), Promise.resolve({ stored: true }));`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@ardia/ardiacore" && context.parentURL?.endsWith("/lib/favicons.ts"))
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
const { adoptFavicons, resolveFavicon, useFavicon } = await import("./favicons.ts");
const { useBrowser } = await import("../store/browser.ts");
const { engineProfile } = await import("../store/model.ts");

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
