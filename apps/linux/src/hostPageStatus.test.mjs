import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { HostPageEvents } from "./hostPageEvents.ts";
import { HostTab } from "./hostTab.ts";
import { applyHostPageTheme, forgetDepartedPage, resetHostPage } from "./hostPageLifecycle.ts";
import { forgetHostPageState, setHostPageHooks } from "./hostPageHooks.ts";
import { readFileSync } from "node:fs";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { pageOf, patchPage, setPopover, usePages } from "../../browser/src/state/tabs/pageState.ts";
import { updateTab } from "../../browser/src/state/tabs/actions.ts";

const lease = { claim: "claim", rendererGeneration: "2", bindingGeneration: "3", documentEpoch: "1" };
const navigation = { url: "https://example.test", committedUrl: "https://example.test", title: "Example", canGoBack: false, canGoForward: false, isLoading: false, themeColor: null, themeColorSource: null };
const security = { level: "secure", url: "https://example.test", origin: "https://example.test" };
const event = (name, data) => ({ name, data });
const message = (sequence, name, data, overrides = {}) => ({ ...lease, type: "pageEvent", sequence, event: event(name, data), ...overrides });
const control = (sequence, documentEpoch, extra = {}) => ({ ...lease, type: "pageLifecycle", sequence, documentEpoch, action: "reset", reason: "document", ...extra });
const popup = (id, url = `https://pop.test/${id}`) => event("popupBlocked", { id, url, origin: "https://example.test" });
const status = ({ fullscreen = false, text = "", hung = false, crashed, popups = [] } = {}) => [
  event("navigation", navigation), event("security", security),
  event("fullscreen", { fullscreen }), event("status", { text }),
  ...(crashed ? [event("crashed", crashed)] : []),
  event(hung ? "unresponsive" : "responsive", {}),
  ...popups.map((id) => popup(id)),
];

function setup(events = status()) {
  useBrowser.getState().hydrate({});
  const window = useBrowser.getState().createWindow({ url: navigation.url });
  const tab = useBrowser.getState().windows[window].tabIds[0];
  const props = {
    onNavigationChange: (value) => updateTab(tab, { url: value.url, title: value.title }, value),
    onSecurity: (value) => patchPage(tab, { security: value }),
    onFullscreen: (fullscreen) => patchPage(tab, { fullscreen }),
    onStatus: (text) => patchPage(tab, { status: text }),
    onCrashed: (crashed) => patchPage(tab, { crashed, unresponsive: false, fullscreen: false, status: "" }),
    onUnresponsive: () => patchPage(tab, { unresponsive: true }),
    onResponsive: () => patchPage(tab, { unresponsive: false }),
    onPopupBlocked: (value) => patchPage(tab, { popups: [...pageOf(tab).popups, value] }),
  };
  const receiver = new HostPageEvents("claim", () => 7, () => props, (reason, replaced) => resetHostPage(tab, reason, replaced), (state) => applyHostPageTheme(tab, state));
  assert.ok(receiver.install({ lease, snapshot: { watermark: 1, events } }));
  const send = (value) => receiver.receive("ArdiaWebView", "7", value);
  return { tab, send, page: () => pageOf(tab) };
}

test("a creation snapshot replays fullscreen, status, crash, hung and every blocked pop-up", () => {
  const crashed = { status: 139, reason: "crashed", code: 139 };
  const h = setup(status({ fullscreen: true, text: "https://example.test/link", hung: true, crashed, popups: ["4", "5"] }));
  const page = h.page();
  assert.equal(page.fullscreen, false);
  assert.deepEqual(page.crashed, crashed);
  assert.equal(page.unresponsive, true);
  assert.equal(page.status, "");
  assert.deepEqual(page.popups.map((p) => p.id), ["4", "5"]);
  const live = setup(status({ fullscreen: true, text: "https://example.test/link", popups: ["9"] }));
  assert.equal(live.page().fullscreen, true);
  assert.equal(live.page().status, "https://example.test/link");
});

test("live producers update page state and hovered links clear with an empty status", () => {
  const h = setup();
  assert.ok(h.send(message(2, "fullscreen", { fullscreen: true })));
  assert.equal(h.page().fullscreen, true);
  assert.ok(h.send(message(3, "fullscreen", { fullscreen: false })));
  assert.equal(h.page().fullscreen, false);
  assert.ok(h.send(message(4, "status", { text: "https://example.test/a" })));
  assert.equal(h.page().status, "https://example.test/a");
  assert.ok(h.send(message(5, "status", { text: "" })));
  assert.equal(h.page().status, "");
  assert.ok(h.send(message(6, "unresponsive", {})));
  assert.equal(h.page().unresponsive, true);
  assert.ok(h.send(message(7, "responsive", {})));
  assert.equal(h.page().unresponsive, false);
  assert.ok(h.send(message(8, "popupBlocked", { id: "4", url: "https://pop.test/4", origin: "https://example.test" })));
  assert.equal(h.page().popups[0].url, "https://pop.test/4");
  assert.ok(h.send(message(9, "crashed", { status: 9, reason: "killed", code: 9 })));
  assert.equal(h.page().crashed.reason, "killed");
});

test("a restore snapshot replaces exactly the producer kinds the native side resends", () => {
  const h = setup(status({ popups: ["1"] }));
  h.send(message(2, "status", { text: "https://example.test/hover" }));
  h.send(message(3, "unresponsive", {}));
  assert.ok(h.send(control(4, "1", { reason: "provisional" })));
  assert.equal(h.send(message(5, "popupBlocked", { id: "2", url: "https://pop.test/2", origin: "" })), false);
  assert.ok(h.send(message(6, "status", { text: "https://example.test/during" })));
  assert.ok(h.send(control(7, "1", { action: "snapshot", reason: "restore", events: status({ text: "https://example.test/during", popups: ["1", "2"] }) })));
  assert.deepEqual(h.page().popups.map((p) => p.id), ["1", "2"]);
  assert.equal(h.page().status, "https://example.test/during");
  assert.equal(h.page().unresponsive, false);
  h.send(message(8, "fullscreen", { fullscreen: true }));
  assert.ok(h.send(control(9, "1", { action: "snapshot", reason: "restore", events: [event("navigation", navigation)] })));
  assert.equal(h.page().fullscreen, true);
  assert.deepEqual(h.page().popups.map((p) => p.id), ["1", "2"]);
});

test("a new document drops every producer's state and stale-epoch events cannot bring it back", () => {
  const h = setup(status({ fullscreen: true, text: "https://example.test/x", hung: true, popups: ["1"] }));
  assert.ok(h.send(control(2, "2")));
  assert.ok(h.send(control(3, "2", { action: "snapshot", events: status() })));
  const page = h.page();
  assert.equal(page.fullscreen, false);
  assert.equal(page.status, "");
  assert.equal(page.unresponsive, false);
  assert.equal(page.crashed, null);
  assert.deepEqual(page.popups, []);
  for (const [name, data] of [["popupBlocked", { id: "1", url: "https://pop.test/1", origin: "" }], ["status", { text: "old" }], ["fullscreen", { fullscreen: true }], ["unresponsive", {}]]) {
    assert.equal(h.send(message(10 + name.length, name, data, { documentEpoch: "1" })), false);
  }
  assert.deepEqual(h.page().popups, []);
  assert.equal(h.page().fullscreen, false);
});

const bootstrap = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/bootstrap.js", import.meta.url), "utf8");

function nativeHost(replies = {}) {
  const requests = [];
  const mounts = new Map();
  let nextTab = 6;
  let bindings = 0;
  const context = {
    location: { protocol: "chrome:", hostname: "ardia" },
    crypto: { randomUUID },
    __ardiaBootstrap: { windowId: "status", profileId: "default" },
    setTimeout, clearTimeout, addEventListener() {}, console,
    chrome: { send(_name, [requestId, , { method, args }]) {
      requests.push({ method, args });
      if (method === "tab.create") {
        const mount = { id: mounts.get(args.key)?.id ?? ++nextTab, claim: args.claim, binding: ++bindings, sequence: 1 };
        mounts.set(args.key, mount);
        const leaseOf = { claim: mount.claim, rendererGeneration: "1", bindingGeneration: String(mount.binding), documentEpoch: "1" };
        mount.lease = leaseOf;
        return context.__ardiaReply(requestId, true, { browserId: mount.id, chromeTabId: mount.id, lease: { ...leaseOf, type: "pageLease", sequence: 1 }, snapshot: { watermark: 1, events: [] } });
      }
      const reply = replies[args.command];
      context.__ardiaReply(requestId, reply === undefined || reply.ok !== false, reply?.value ?? reply?.error ?? null);
    } },
  };
  context.window = context;
  context.top = context;
  runInNewContext(bootstrap, context);
  return {
    host: context.__ardiaHost, requests,
    send(key, name, data, mount = mounts.get(key)) {
      context.__ardiaEvent("ArdiaWebView", String(mount.id), { ...mount.lease, type: "pageEvent", sequence: ++mount.sequence, event: { name, data } });
    },
    mount: (key) => mounts.get(key),
  };
}

const receiver = (props) => (claim, nativeId, rebound) => new HostPageEvents(claim, nativeId, () => props, () => {}, () => {}, rebound);

test("recovery, pop-up and favicon commands reach the exact pane and its producers reach only that pane", async () => {
  const image = { uri: "data:image/png;base64,AAAA", width: 16, height: 16 };
  const native = nativeHost({ downloadFavicon: { value: image }, openBlockedPopup: { ok: false, error: "The blocked pop-up is no longer available" } });
  const left = [], right = [];
  const props = (into) => ({
    onFullscreen: (value) => into.push(["fullscreen", value]), onStatus: (value) => into.push(["status", value]),
    onUnresponsive: () => into.push(["unresponsive"]), onPopupBlocked: (value) => into.push(["popup", value.id]),
  });
  const a = new HostTab(native.host, { key: "left" }, () => {}, receiver(props(left)));
  const b = new HostTab(native.host, { key: "right" }, () => {}, receiver(props(right)));
  await Promise.all([a.ready, b.ready]);
  try {
    assert.equal(await b.command("resolveUnresponsive", [true]), null);
    assert.deepEqual(native.requests.at(-1), { method: "tab.command", args: { id: b.identity.browserId, claim: b.claim, command: "resolveUnresponsive", args: [true] } });
    assert.deepEqual(await b.command("downloadFavicon", ["https://example.test/favicon.ico"]), image);
    assert.equal(native.requests.at(-1).args.id, b.identity.browserId);
    await assert.rejects(b.command("openBlockedPopup", ["4", false]), /no longer available/);
    native.send("right", "fullscreen", { fullscreen: true });
    native.send("right", "status", { text: "https://example.test/link" });
    native.send("right", "unresponsive", {});
    native.send("right", "popupBlocked", { id: "4", url: "https://pop.test/4", origin: "" });
    assert.deepEqual(right, [["fullscreen", true], ["status", "https://example.test/link"], ["unresponsive"], ["popup", "4"]]);
    assert.deepEqual(left, []);
    const stale = native.mount("right");
    const c = new HostTab(native.host, { key: "right" }, () => {}, receiver(props(right)));
    await c.ready;
    native.send("right", "status", { text: "old" }, stale);
    assert.equal(right.filter(([kind, value]) => kind === "status" && value === "old").length, 0);
    c.dispose();
  } finally {
    a.dispose(); b.dispose(); await new Promise(setImmediate);
  }
});

test("a page that leaves this window drops its state here and a page that stays keeps it", () => {
  const h = setup(status({ text: "https://example.test/link", popups: ["4"] }));
  const windowId = useBrowser.getState().tabs[h.tab].windowId;
  setPopover(h.tab, "popups");
  forgetDepartedPage(h.tab, windowId);
  assert.deepEqual(h.page().popups.map((p) => p.id), ["4"]);
  assert.equal(usePages.getState().popover[h.tab], "popups");
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [h.tab]: { ...s.tabs[h.tab], windowId: "elsewhere" } } }));
  forgetDepartedPage(h.tab, windowId);
  assert.equal(usePages.getState().pages[h.tab], undefined);
  assert.equal(usePages.getState().popover[h.tab], undefined);
  assert.deepEqual(h.page().popups, []);
  assert.equal(h.page().status, "");
  const closed = setup(status({ popups: ["5"] }));
  const closedWindow = useBrowser.getState().tabs[closed.tab].windowId;
  useBrowser.setState((s) => { const { [closed.tab]: _gone, ...tabs } = s.tabs; return { tabs }; });
  forgetDepartedPage(closed.tab, closedWindow);
  assert.equal(usePages.getState().pages[closed.tab], undefined);
});

test("a view that unmounts before the store moves its tab drops the tab's state once the move lands", () => {
  const h = setup(status({ text: "https://example.test/link", popups: ["6"] }));
  const windowId = useBrowser.getState().tabs[h.tab].windowId;
  setPopover(h.tab, "popups");
  forgetDepartedPage(h.tab, windowId);
  assert.deepEqual(h.page().popups.map((p) => p.id), ["6"]);
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [h.tab]: { ...s.tabs[h.tab], windowId: "elsewhere" } } }));
  assert.equal(usePages.getState().pages[h.tab], undefined);
  assert.equal(usePages.getState().popover[h.tab], undefined);
  const stays = setup(status({ popups: ["7"] }));
  const here = useBrowser.getState().tabs[stays.tab].windowId;
  forgetDepartedPage(stays.tab, here);
  resetHostPage(stays.tab, "mount");
  patchPage(stays.tab, { status: "remounted" });
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [stays.tab]: { ...s.tabs[stays.tab], windowId: "elsewhere" } } }));
  assert.equal(stays.page().status, "remounted");
});

test("a host tab view's unmount reaches forgetDepartedPage with this window's id", () => {
  const departed = [];
  setHostPageHooks({ reset() {}, applyTheme() {}, depart: (tabId) => departed.push(tabId) });
  forgetHostPageState("t1");
  assert.deepEqual(departed, ["t1"]);
  const view = readFileSync(new URL("./shims/web/HostWebView.tsx", import.meta.url), "utf8");
  const cleanup = view.slice(view.indexOf("return () => {"), view.indexOf("}, []);", view.indexOf("return () => {")));
  assert.match(cleanup, /const tabId = latest\.current\.tabId;\n\s+if \(tabId\) forgetHostPageState\(tabId\);/);
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  assert.match(main, /depart: \(tabId\) => ardiaHost && forgetDepartedPage\(tabId, ardiaHost\.bootstrap\.windowId\)/);
});
