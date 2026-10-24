import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../test-hooks.mjs";

globalThis.__DEV__ = false;
const native = new URL("../test-native-stub.mjs", import.meta.url).href;
const moduleSource = `export * from ${JSON.stringify(native)};
export const fetchFavicon = (...args) => globalThis.fetchTestIcon(...args);
export const faviconsFor = async (profile, pages) => ({ pages: new Map(pages.filter(p => p.includes("cached")).map(p => [p, { uri: "file:///cached.png" }])) });`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@ardia/ardiacore" && context.parentURL?.endsWith("/lib/favicons.ts"))
      return { url: `data:text/javascript,${encodeURIComponent(moduleSource)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
const { useFavicon } = await import("./favicons.ts");
const { useBrowser } = await import("../store/browser.ts");
const waitFor = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(check(), "condition reached before deadline");
};

test("fallback icons queue at four concurrent fetches and cached pages never fetch", async () => {
  useBrowser.getState().hydrate({});
  const pending = [];
  const fetched = [];
  let active = 0;
  let maximum = 0;
  globalThis.fetchTestIcon = (src) => {
    fetched.push(src);
    active++;
    maximum = Math.max(maximum, active);
    return new Promise(resolve => pending.push(() => {
      active--;
      resolve(null);
    }));
  };
  const pages = Array.from({ length: 9 }, (_, i) => `https://queue-${i}.test/`);
  const hooks = [...pages, "https://cached.test/"].map(url => mount(() => useFavicon(url, `${url}favicon.ico`, "default")));
  try {
    await waitFor(() => fetched.length === 4 && hooks.at(-1).value !== null);
    assert.equal(active, 4);
    assert.equal(fetched.some(src => src.includes("cached")), false);
    pending.shift()();
    await waitFor(() => fetched.length === 5);
    assert.equal(active, 4);
    await waitFor(() => {
      while (pending.length) pending.shift()();
      return fetched.length === pages.length && active === 0;
    });
    assert.equal(fetched.length, 9);
    assert.equal(maximum, 4);
  } finally {
    for (const hook of hooks) hook.unmount();
    delete globalThis.fetchTestIcon;
  }
});
