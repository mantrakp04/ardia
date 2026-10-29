import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;

const performance = import.meta.resolve("../../platform/performance.ts");
const profiles = import.meta.resolve("../../platform/profiles.ts");
const stubs = {
  "../../platform/performance": `export * from ${JSON.stringify(performance)};
    export const listTasks = async () => [];
    export const onSystemState = () => ({ remove() {} });
    export const systemState = async () => null;`,
  "../../platform/profiles": `export * from ${JSON.stringify(profiles)};
    export const releaseProfile = async () => {};`,
  "../app/toasts": "export const showToast = () => {};",
  "../settings/settingsWindows": "export const openSettings = () => {};",
  "../pages/urls": "export const isInternalTab = (t) => !/^https?:/.test(t.url ?? '');",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!/\/state\/tabs\/(?:tabLifecycle|memorySaver|shownTabs)\.ts$/.test(context.parentURL ?? "") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});
const { useBrowser } = await import("../browser/store.ts");
const { useIsActiveTab, useTab, useTabLive, WindowContext } = await import("../browser/hooks.ts");
const { useTabValue, useStoreWhile, shallowEqual } = await import("./tabWatch.ts");
const { usePageProgress, setPageProgress } = await import("./pageProgress.ts");
const { useRowState, ACTIVE, SELECTED, PLAYING, LOADING } = await import("../sidebar/rowState.ts");
const { useSidebarUi, setSidebarUi } = await import("../sidebar/sidebarUi.ts");
const { useIsSleeping, noteDiscarded, noteReady } = await import("./tabLifecycle.ts");
const { useMedia, setPictureInPictureState } = await import("../media/media.ts");
const { usePage, usePages, patchPage } = await import("./pageState.ts");
const { useFavicons, useFavicon, useFaviconTheme, useAppearanceDark } = await import("../favicons/favicons.ts");
const { withoutFragment } = await import("../../lib/url.ts");
const { engineProfile } = await import("../browser/model.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const setup = () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  return { w, a };
};

const row = (tabId, windowId) =>
  mount(
    () => {
      const { tab, flags } = useRowState(tabId, windowId);
      return {
        title: tab?.customTitle ?? tab?.title,
        url: tab?.url,
        pinned: !!tab?.pin,
        favicon: tab?.favicon,
        gone: !tab,
        active: !!(flags & ACTIVE),
        selected: !!(flags & SELECTED),
        playing: !!(flags & PLAYING),
        loading: !!(flags & LOADING),
        renaming: useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId),
        sleeping: useIsSleeping(tabId),
        pip: useMedia((m) => !!m.pipOpen[tabId]),
        capture: usePage(tabId, (p) => !!p.mediaAccess),
        profile: useTabValue(tabId, (t) => t?.profileId),
      };
    },
    { contexts: [[WindowContext, windowId]] },
  );

test("a sidebar row: created, renamed, re-iconed, pinned, flagged, badged, slept, woken, closed", () => {
  const { w, a } = setup();
  const b = S().newTab(w, { url: "https://b.com/", background: true });
  const ra = row(a, w);
  const rb = row(b, w);
  assert.equal(rb.value.url, "https://b.com/", "created: shows");
  assert.equal(ra.value.active, true);
  assert.equal(rb.value.active, false);

  S().updateTab(b, { title: "B title" });
  assert.equal(rb.value.title, "B title", "retitled");
  S().updateTab(b, { customTitle: "Renamed" });
  assert.equal(rb.value.title, "Renamed", "renamed");
  setSidebarUi({ renaming: { windowId: w, kind: "tab", id: b } });
  assert.deepEqual([ra.value.renaming, rb.value.renaming], [false, true], "rename field on its row only");
  setSidebarUi({ renaming: null });
  assert.equal(rb.value.renaming, false, "rename field gone");

  S().updateTab(b, { favicon: "https://b.com/new.ico" });
  assert.equal(rb.value.favicon, "https://b.com/new.ico", "favicon change");
  S().togglePin(b);
  assert.equal(rb.value.pinned, true, "pinned");
  S().togglePin(b);
  assert.equal(rb.value.pinned, false, "unpinned");

  S().activate(b);
  assert.deepEqual([ra.value.active, rb.value.active], [false, true], "switch: both rows");
  S().setSelection(w, [a, b]);
  assert.deepEqual([ra.value.selected, rb.value.selected], [true, true], "selected");
  S().setSelection(w, []);
  assert.deepEqual([ra.value.selected, rb.value.selected], [false, false], "deselected");
  S().updateLive(a, { isLoading: true, playingAudio: true });
  assert.deepEqual([ra.value.loading, ra.value.playing], [true, true], "loading and audio");
  S().updateLive(a, { isLoading: false, playingAudio: false });
  assert.deepEqual([ra.value.loading, ra.value.playing], [false, false], "done");

  setPictureInPictureState(a, { kind: "video", active: true });
  assert.equal(ra.value.pip, true, "PiP badge on");
  setPictureInPictureState(a, { kind: "video", active: false });
  assert.equal(ra.value.pip, false, "PiP badge off");
  patchPage(a, { mediaAccess: { camera: true, microphone: false, screen: false } });
  assert.equal(ra.value.capture, true, "capture badge on");
  patchPage(a, { mediaAccess: null });
  assert.equal(ra.value.capture, false, "capture badge off");

  noteDiscarded(a);
  assert.equal(ra.value.sleeping, true, "asleep");
  noteReady(a);
  assert.equal(ra.value.sleeping, false, "awake");

  const c = S().newTab(w, { url: "https://c.com/", background: true });
  S().moveTabsToWindow([c], null);
  const moved = S().tabs[c].windowId;
  const rc = row(c, moved);
  S().activate(c);
  assert.equal(rc.value.active, true, "a tab moved to another window is active there");

  S().closeTab(b);
  assert.equal(rb.value.gone, true, "closed: gone");
  assert.equal(ra.value.active, true, "the tab shown after it");
  for (const r of [ra, rb, rc]) r.unmount();
});

test("a row's tab and flags survive a relaunch: a row mounted on the restored session shows it", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const w = S().createWindow({ url: "https://a.com/" });
  const b = S().newTab(w, { url: "https://b.com/", background: true });
  S().updateTab(b, { title: "Before quit", pin: { as: "tile" } });
  S().activate(b);
  flushPersistence();
  stop();
  S().hydrate({});
  S().hydrate(loadSession());
  const r = row(b, w);
  assert.equal(r.value.title, "Before quit");
  assert.equal(r.value.pinned, true);
  assert.equal(r.value.active, true);
  S().updateTab(b, { title: "After relaunch" });
  assert.equal(r.value.title, "After relaunch", "and follows the restored tab");
  r.unmount();
});

test("useTab, useTabLive and useIsActiveTab follow a tab through its life, and a tab id reused after a close", () => {
  const { w, a } = setup();
  const b = S().newTab(w, { url: "https://b.com/", background: true });
  const h = mount(() => ({ tab: useTab(b), loading: useTabLive(b, (l) => l.isLoading), active: useIsActiveTab(b) }));
  assert.equal(h.value.tab.url, "https://b.com/");
  S().updateTab(b, { url: "https://b2.com/" });
  assert.equal(h.value.tab.url, "https://b2.com/");
  S().updateLive(b, { isLoading: true });
  assert.equal(h.value.loading, true);
  S().activate(b);
  assert.equal(h.value.active, true);
  S().activate(a);
  assert.equal(h.value.active, false);
  S().closeTab(b);
  assert.equal(h.value.tab, undefined);
  assert.equal(h.value.loading, false, "a closed tab's live state is idle");
  h.unmount();
});

test("a hidden pane's paused reads are current the render it's shown, and follow the store from then on", () => {
  const { w, a } = setup();
  const pane = mount(
    ({ visible }) => ({
      own: useTabValue(a, (t) => ({ url: t?.url ?? "", zoom: t?.zoom ?? 1 }), shallowEqual),
      popover: useStoreWhile(usePages, visible, (s) => s.popover[a] ?? null),
      newTabShown: useStoreWhile(usePages, visible, (s) => !!s.pages[a]?.newTabShown),
      hasPage: useStoreWhile(useBrowser, visible, (s) => !!s.tabs[a]?.url),
    }),
    { props: { visible: false } },
  );
  const renders = pane.renders;
  S().updateTab(a, { url: "https://moved.com/", zoom: 1.5 });
  assert.deepEqual(pane.value.own, { url: "https://moved.com/", zoom: 1.5 }, "URL and zoom while hidden");
  const afterOwn = pane.renders;
  usePages.setState((s) => ({ popover: { ...s.popover, [a]: "zoom" } }));
  patchPage(a, { newTabShown: { url: "x" } });
  assert.equal(pane.pending, false, "paused reads don't wake a hidden pane");
  assert.equal(pane.renders, afterOwn);
  assert.ok(afterOwn > renders);
  const shown = pane.rerender({ visible: true });
  assert.equal(shown.popover, "zoom");
  assert.equal(shown.newTabShown, true);
  usePages.setState((s) => ({ popover: { ...s.popover, [a]: null } }));
  assert.equal(pane.value.popover, null, "and follows the store while shown");
  S().updateTab(a, { url: "" });
  assert.equal(pane.value.hasPage, false);
  pane.rerender({ visible: false });
  S().updateTab(a, { url: "https://back.com/" });
  assert.equal(pane.rerender({ visible: true }).hasPage, true, "a change while hidden again");
  pane.unmount();
  void w;
});

test("page progress: a bar mounted mid-load starts at the current value, follows reports, and a gone page reads 0", () => {
  setPageProgress("p", 0.4);
  const bar = mount(() => usePageProgress("p"));
  assert.equal(bar.value, 0.4);
  setPageProgress("p", 0.8);
  assert.equal(bar.value, 0.8);
  setPageProgress("p", 0);
  assert.equal(bar.value, 0, "page gone (closed, slept, another profile)");
  bar.unmount();
  const other = mount(({ id }) => usePageProgress(id), { props: { id: "p" } });
  setPageProgress("q", 0.5);
  assert.equal(other.rerender({ id: "q" }), 0.5, "a bar that moves to another tab reads that tab's");
  other.unmount();
});

const key = engineProfile(S(), "default");
const setIcons = (fn) =>
  useFavicons.setState((f) => {
    const icons = f.profiles[key] ?? { pages: {}, srcs: {}, appearances: {} };
    return { ...f, profiles: { ...f.profiles, [key]: fn(icons) } };
  });
const icon = (url, src) =>
  mount(({ url, src }) => {
    useAppearanceDark();
    return { resolved: useFavicon(url, src, "default"), theme: useFaviconTheme(url, src, "default") };
  }, { props: { url, src } });

test("an icon: arrives, changes, follows its page and its icon URL, its light/dark pair and theme, and goes", () => {
  S().hydrate({});
  useBrowser.setState((s) => ({ ui: { ...s.ui, appDark: false } }));
  useFavicons.setState({ profiles: {}, themes: {} });
  const page = "https://icons.example/a";
  const i = icon(page, null);
  assert.equal(i.value.resolved, null, "none yet");
  setIcons((x) => ({ ...x, pages: { ...x.pages, [withoutFragment(page)]: "file:///one.png" } }));
  assert.equal(i.value.resolved?.uri, "file:///one.png", "arrives");
  setIcons((x) => ({ ...x, pages: { ...x.pages, [withoutFragment(page)]: "file:///two.png" } }));
  assert.equal(i.value.resolved?.uri, "file:///two.png", "changes");
  useFavicons.setState((f) => ({ ...f, themes: { ...f.themes, "file:///two.png": { kind: "template", stroke: true } } }));
  assert.equal(i.value.theme?.kind, "template", "its shape theme");
  i.rerender({ url: page, src: "https://icons.example/b.ico" });
  setIcons((x) => ({ ...x, srcs: { ...x.srcs, "https://icons.example/b.ico": "file:///b.png" } }));
  assert.equal(i.value.resolved?.uri, "file:///b.png", "a new icon URL's image");
  setIcons((x) => ({ ...x, appearances: { ...x.appearances, [withoutFragment(page)]: ["file:///light.png", "file:///dark.png"] } }));
  assert.equal(i.value.resolved?.uri, "file:///light.png");
  useBrowser.setState((s) => ({ ui: { ...s.ui, appDark: true } }));
  assert.equal(i.value.resolved?.uri, "file:///dark.png", "dark appearance");
  useBrowser.setState((s) => ({ ui: { ...s.ui, appDark: false } }));
  assert.equal(i.value.resolved?.uri, "file:///light.png", "and back");
  useFavicons.setState((f) => ({ ...f, profiles: { ...f.profiles, [key]: { pages: {}, srcs: {}, appearances: {} } } }));
  assert.equal(i.value.resolved, null, "gone");
  i.unmount();
});
