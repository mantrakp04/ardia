import assert from "node:assert/strict";
import test from "node:test";
import { HostTab } from "./hostTab.ts";
import { HostPageEvents } from "./hostPageEvents.ts";

const settle = () => new Promise(setImmediate);
const lease = (claim, extra = {}) => ({ claim, rendererGeneration: "2", bindingGeneration: "5", documentEpoch: "1", ...extra });
const navigation = { url: "https://example.test/", committedUrl: "https://example.test/", title: "Example", canGoBack: false, canGoForward: false, isLoading: false, themeColor: null, themeColorSource: null };
const security = { level: "secure", url: "https://example.test/", origin: "https://example.test" };

function nativeHost({ snapshot = true } = {}) {
  const listeners = new Set();
  const requests = [];
  let active = "";
  let sequence = 0;
  let epoch = 1;
  let binding = "5";
  let channel = "7";
  let securityReply = security;
  let beforeSecurityReply;
  const host = {
    bootstrap: { windowId: "owned", profileId: "default" },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invoke(method, args) {
      requests.push({ method, args });
      if (method === "tab.create") {
        active = args.claim;
        const metadata = lease(args.claim, { bindingGeneration: binding, documentEpoch: String(epoch), type: "pageLease", sequence: ++sequence });
        emit({ type: "navigation", state: { ...navigation, title: "legacy" } });
        return { browserId: 7, chromeTabId: 7, state: navigation,
          ...(snapshot ? { lease: metadata, snapshot: { watermark: sequence, events: [{ name: "navigation", data: navigation }, { name: "security", data: security }, { name: "zoom", data: { zoom: 1.2, host: "example.test", isDefault: false, pinchScale: 1 } }] } } : {}) };
      }
      if (method === "tab.release") { assert.equal(args.claim, active); active = ""; }
      if (method === "tab.command" && args.command === "getSecurityInfo") {
        beforeSecurityReply?.();
        return securityReply;
      }
      return null;
    },
  };
  function emit(payload, id = channel) { for (const listener of [...listeners]) listener("ArdiaWebView", id, payload); }
  const current = () => lease(active, { bindingGeneration: binding, documentEpoch: String(epoch) });
  const page = (name, data) => emit({ ...current(), type: "pageEvent", sequence: ++sequence, event: { name, data } });
  const reset = (reason) => { if (reason === "document") epoch++; emit({ ...current(), type: "pageLifecycle", sequence: ++sequence, action: "reset", reason }); };
  const rebind = (browserId, { nextBinding = String(Number(binding) + 1), claim = active, events = [{ name: "navigation", data: { ...navigation, title: "Discarded" } }] } = {}) => {
    const notice = { ...current(), type: "pageLifecycle", sequence: ++sequence, action: "rebind",
      creation: { browserId, chromeTabId: browserId, state: navigation, lease: lease(claim, { bindingGeneration: nextBinding, documentEpoch: "1", type: "pageLease", sequence: 1 }), snapshot: { watermark: 1, events } } };
    const previous = channel;
    if (claim === active) { binding = nextBinding; channel = String(browserId); epoch = 1; sequence = 1; }
    emit(notice, previous);
  };
  return { host, requests, emit, page, reset, rebind, active: () => active, listeners, channel: () => channel,
    setSecurityReply(value) { securityReply = value; }, onSecurityRequest(callback) { beforeSecurityReply = callback; } };
}

function mount(native, options = {}) {
  const calls = [];
  const props = {
    onNavigationChange: (state) => calls.push(["navigation", state]),
    onSecurity: (state) => calls.push(["security", state]),
    onZoom: (state) => calls.push(["zoom", state]),
    onProgress: (value) => calls.push(["progress", value]),
    onWindowClose: () => calls.push(["windowClose"]),
    onOpenWindow: (request) => calls.push(["openWindow", request]),
    onFavicon: (url, urls) => calls.push(["favicon", url, urls]),
    onPictureInPicture: (state) => calls.push(["pictureInPicture", state]),
    onLoadError: (error) => calls.push(["loadError", error]),
    onPageFocus: (...args) => calls.push(["pageFocus", ...args]),
  };
  const ready = [];
  const tab = new HostTab(native.host, { key: options.key ?? "stable" }, (event) => ready.push(event),
    (claim, nativeId, rebound) => new HostPageEvents(claim, nativeId, () => props, (reason) => calls.push(["reset", reason]), () => {}, rebound));
  return { tab, calls, ready };
}

test("create response installs the lease snapshot and ignores legacy ID-only events", async () => {
  const native = nativeHost();
  const { tab, calls, ready } = mount(native);
  await tab.ready;
  assert.deepEqual(calls.map(([name]) => name), ["reset", "navigation", "security", "zoom"]);
  assert.equal(calls[1][1].title, "Example");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].type, "ready");
  native.emit({ type: "navigation", state: { ...navigation, title: "legacy" } });
  native.emit({ type: "title", title: "legacy" });
  assert.equal(calls.length, 4);
  native.page("progress", { progress: 0.5 });
  native.page("favicon", { url: "https://example.test/a.ico", urls: ["https://example.test/a.ico"] });
  native.page("openWindow", { url: "chrome://settings", disposition: "foreground", adoptId: "tab:9", profile: "" });
  native.page("pictureInPicture", { active: true, kind: "video" });
  native.page("loadError", { url: "https://down.test/", code: -105, text: "ERR_NAME_NOT_RESOLVED" });
  assert.deepEqual(calls.slice(4), [["progress", 0.5], ["favicon", "https://example.test/a.ico", ["https://example.test/a.ico"]],
    ["openWindow", { url: "ardia://settings", disposition: "foreground", adoptId: "tab:9", profile: "" }],
    ["pictureInPicture", { active: true, kind: "video" }], ["loadError", { url: "https://down.test/", code: -105, text: "ERR_NAME_NOT_RESOLVED" }]]);
  native.page("focus", {});
  assert.deepEqual(calls.at(-1), ["pageFocus"]);
  native.emit({ type: "pageFocus" });
  assert.deepEqual(calls.at(-1), ["pageFocus"]);
  native.page("windowClose", {});
  assert.deepEqual(calls.at(-1), ["windowClose"]);
  tab.dispose();
  await settle();
});

test("events for another channel or after disposal never reach the page", async () => {
  const native = nativeHost();
  const { tab, calls } = mount(native);
  await tab.ready;
  const before = calls.length;
  native.emit({ ...lease(native.active()), type: "pageEvent", sequence: 99, event: { name: "progress", data: { progress: 1 } } }, "8");
  assert.equal(calls.length, before);
  tab.dispose();
  native.page("progress", { progress: 0.2 });
  assert.equal(calls.length, before);
  await settle();
  assert.equal(native.active(), "");
});

test("a create response without a page lease releases the native claim instead of mounting", async () => {
  const native = nativeHost({ snapshot: false });
  const { tab, calls } = mount(native);
  await assert.rejects(tab.ready, /page lease/);
  await settle();
  assert.equal(native.active(), "");
  assert.deepEqual(native.requests.map(({ method }) => method), ["tab.create", "tab.release"]);
  assert.equal(calls.length, 0);
});

test("security results are fenced by the request captured before the command", async () => {
  const native = nativeHost();
  const { tab } = mount(native);
  await tab.ready;
  assert.deepEqual(await tab.pageResult("getSecurityInfo"), security);
  native.onSecurityRequest(() => native.reset("provisional"));
  assert.equal(await tab.pageResult("getSecurityInfo"), null);
  native.onSecurityRequest(undefined);
  assert.equal(await tab.pageResult("getSecurityInfo"), null);
  const issued = native.requests.filter(({ args }) => args.command === "getSecurityInfo").length;
  assert.equal(issued, 2);
  native.reset("document");
  native.onSecurityRequest(() => native.reset("document"));
  assert.equal(await tab.pageResult("getSecurityInfo"), null);
  native.onSecurityRequest(undefined);
  assert.deepEqual(await tab.pageResult("getSecurityInfo"), security);
  tab.dispose();
  assert.equal(await tab.pageResult("getSecurityInfo"), null);
  await settle();
});

test("replacement routes events only to the newest claim's receiver", async () => {
  const native = nativeHost();
  const first = mount(native);
  await first.tab.ready;
  const second = mount(native);
  await second.tab.ready;
  const firstCount = first.calls.length;
  native.page("progress", { progress: 0.7 });
  assert.equal(first.calls.length, firstCount);
  assert.deepEqual(second.calls.at(-1), ["progress", 0.7]);
  first.tab.dispose();
  second.tab.dispose();
  await settle();
});

test("a discard rebind notice re-installs the fresh lease and moves commands to the new native id", async () => {
  const native = nativeHost();
  const { tab, calls } = mount(native);
  await tab.ready;
  calls.length = 0;
  native.rebind(11);
  assert.deepEqual(calls.map(([name]) => name), ["reset", "navigation"]);
  assert.equal(calls[1][1].title, "Discarded");
  assert.equal(tab.identity.browserId, 11);
  native.page("progress", { progress: 0.3 });
  assert.deepEqual(calls.at(-1), ["progress", 0.3]);
  const delivered = calls.length;
  native.emit({ ...lease(native.active()), type: "pageEvent", sequence: 50, event: { name: "progress", data: { progress: 0.9 } } }, "7");
  native.emit({ ...lease(native.active()), type: "pageEvent", sequence: 51, event: { name: "progress", data: { progress: 0.9 } } }, "11");
  assert.equal(calls.length, delivered);
  await tab.command("zoomStep", [1]);
  assert.equal(native.requests.at(-1).args.id, 11);
  tab.dispose();
  await settle();
  assert.equal(native.requests.at(-1).method, "tab.release");
  assert.equal(native.requests.at(-1).args.id, 11);
});

test("a rebind during an in-flight security request drops the stale result", async () => {
  const native = nativeHost();
  const { tab } = mount(native);
  await tab.ready;
  native.onSecurityRequest(() => native.rebind(12));
  assert.equal(await tab.pageResult("getSecurityInfo"), null);
  native.onSecurityRequest(undefined);
  assert.deepEqual(await tab.pageResult("getSecurityInfo"), security);
  assert.equal(native.requests.at(-1).args.id, 12);
  tab.dispose();
  await settle();
});

test("rebind notices for another claim or an older binding are rejected", async () => {
  const native = nativeHost();
  const { tab, calls } = mount(native);
  await tab.ready;
  const before = calls.length;
  native.rebind(13, { claim: "intruder" });
  native.rebind(13, { nextBinding: "4" });
  native.rebind(13, { nextBinding: "5" });
  assert.equal(calls.length, before);
  assert.equal(tab.identity.browserId, 7);
  tab.dispose();
  await settle();
});

test("Chrome's open-link-in-private request reaches the shell as an incognito window request without an adopted tab", async () => {
  const native = nativeHost();
  const { tab, calls } = mount(native);
  await tab.ready;
  native.page("openWindow", { url: "https://private.example.test/", disposition: "incognito", profile: "work" });
  assert.deepEqual(calls.at(-1), ["openWindow", { url: "https://private.example.test/", disposition: "incognito", profile: "work" }]);
  tab.dispose();
  await settle();
});
