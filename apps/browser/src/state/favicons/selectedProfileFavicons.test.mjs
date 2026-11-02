import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;

const native = import.meta.resolve("../../platform/favicons.ts");
const stub = `export * from ${JSON.stringify(native)};
export const faviconsFor = (profile, pages) => globalThis.faviconsForTest(profile, pages);
export const storeFavicon = (...args) => (globalThis.storedFavicons.push(args), Promise.resolve({ stored: true }));
export const fetchFavicon = (src, profile) => (globalThis.fetchFaviconForTest ? globalThis.fetchFaviconForTest(src, profile) : Promise.resolve(null));`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "../../platform/favicons" && context.parentURL?.endsWith("/state/favicons/favicons.ts"))
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
const nativeState = await import("../../test-native/index.ts");

const { startFavicons, useFavicon, useFavicons, resolveFavicon } = await import("./favicons.ts");
const { useBrowser } = await import("../browser/store.ts");

const { configureProfileStartup } = await import("../profiles/startupEngineProfiles.ts");
configureProfileStartup({ loadProfilesWhenOpened: true });

const waitFor = async (check) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), "reached before the deadline");
};

test("generic favicons read selected profiles, reuse inactive cached icons and demand-load on switching", async () => {
  const state = () => useBrowser.getState();
  state().hydrate({});
  const work = state().createProfile({ name: "Work" });
  const dormant = state().createProfile({ name: "Dormant" });
  const windowId = state().createWindow({ profileId: "default" });
  const page = "https://generic-profile-memory.example/";
  const cachedPage = "https://cached-profile-memory.example/";
  const cached = "data:image/png;base64,AAAA";
  useFavicons.setState({ profiles: { [work]: { pages: { [cachedPage]: cached }, srcs: {}, appearances: {} } } });
  const lookups = [];
  const fetched = [];
  globalThis.fetchFaviconForTest = async (src, profile) => (fetched.push({ src, profile }), null);
  globalThis.faviconsForTest = async (profile, pages) => (lookups.push({ profile, pages }), { pages: new Map(), icons: new Map() });
  globalThis.storedFavicons = [];
  const stop = startFavicons();
  const generic = mount(() => useFavicon(page));
  const cachedRow = mount(() => useFavicon(cachedPage));
  let explicit;
  try {
    await waitFor(() => lookups.length >= 1);
    assert.deepEqual([...new Set(lookups.map((lookup) => lookup.profile))], [""]);
    assert.equal(resolveFavicon(cachedPage)?.uri, cached);
    state().switchProfile(windowId, work);
    await waitFor(() => lookups.some((lookup) => lookup.profile === work && lookup.pages.includes(page)));
    assert.ok(!lookups.some((lookup) => lookup.profile === dormant));
    explicit = mount(() => useFavicon(page, "https://generic-profile-memory.example/favicon.ico", dormant));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(!lookups.some((lookup) => lookup.profile === dormant), "hidden explicit rows do not load an inactive profile");
    assert.ok(!fetched.some((fetch) => fetch.profile === dormant), "hidden explicit rows do not fetch icons in an inactive profile");
    state().switchProfile(windowId, dormant);
    await waitFor(() => lookups.some((lookup) => lookup.profile === dormant));
  } finally {
    generic.unmount();
    cachedRow.unmount();
    explicit?.unmount();
    stop();
    delete globalThis.faviconsForTest;
    delete globalThis.fetchFaviconForTest;
  }
});
