import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_VIEW_MODULE, HostExtensionView, extensionViewsSupported } from "./hostExtensionView.ts";
import { resolveHostModule } from "./hostModules.ts";
import { HostTab } from "./hostTab.ts";

const ID = "a".repeat(32);
const POPUP = `chrome-extension://${ID}/popup.html`;

function nativeSurfaces({ capabilities = ["extensionView.create", "extensionView.viewport", "extensionView.command", "extensionView.release"] } = {}) {
  const listeners = new Set();
  const requests = [];
  const calls = [];
  const live = new Set();
  let next = 0;
  let hold;
  let failure;
  const host = {
    bootstrap: { windowId: "main", profileId: "default", capabilities },
    call: async (name, profile, args) => {
      calls.push({ name, profile, args });
      return "{}";
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invoke(method, args) {
      requests.push({ method, args });
      if (method === "extensionView.create") {
        if (hold) await hold;
        if (failure) { const error = failure; failure = undefined; throw error; }
        const id = ++next;
        live.add(id);
        return { id };
      }
      if (method === "extensionView.release") { live.delete(args.id); return null; }
      if (!live.has(args.id)) throw Object.assign(new Error("No such extension view"), { code: "ERR_EXTENSION_VIEW_STALE" });
      if (method === "extensionView.command" && args.command === "evaluate") return null;
      return null;
    },
  };
  const emit = (module, event, payload) => { for (const listener of [...listeners]) listener(module, event, payload); };
  return {
    host, requests, calls, live, emit, listeners,
    hold() { let release; hold = new Promise((done) => { release = done; }); return () => { hold = undefined; release(); }; },
    fail(error) { failure = error; },
  };
}

const settle = () => new Promise(setImmediate);

test("extension views require the native surface capability and otherwise fall back to tabs", () => {
  assert.equal(extensionViewsSupported(nativeSurfaces().host), true);
  assert.equal(extensionViewsSupported(nativeSurfaces({ capabilities: [] }).host), false);
  assert.equal(extensionViewsSupported(undefined), false);
});

test("a popup is created as an extension surface with its kind, URL and resolved profile", async () => {
  const f = nativeSurfaces();
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP }, () => {});
  assert.equal(await view.ready, 1);
  assert.deepEqual(f.requests[0], { method: "extensionView.create", args: { kind: "popup", url: POPUP, profile: "default" } });
  view.dispose();
  await settle();
  assert.deepEqual(f.requests.at(-1), { method: "extensionView.release", args: { id: 1 } });
  assert.equal(f.live.size, 0);
  assert.equal(f.listeners.size, 0);
});

test("events are delivered only for the surface's own id, including ones that arrive before the create reply", async () => {
  const f = nativeSurfaces();
  const release = f.hold();
  const events = [];
  const view = new HostExtensionView(f.host, { kind: "sidePanel", url: POPUP, profile: "default" }, (event) => events.push(event));
  await settle();
  f.emit(EXTENSION_VIEW_MODULE, "1", { type: "ready" });
  f.emit(EXTENSION_VIEW_MODULE, "2", { type: "windowClose" });
  f.emit("ArdiaWebView", "1", { type: "navigation" });
  release();
  await view.ready;
  f.emit(EXTENSION_VIEW_MODULE, "1", { type: "preferredSize", value: { width: 300, height: 200 } });
  f.emit(EXTENSION_VIEW_MODULE, "3", { type: "preferredSize", value: { width: 1, height: 1 } });
  assert.deepEqual(events, [{ type: "ready" }, { type: "preferredSize", value: { width: 300, height: 200 } }]);
  view.dispose();
  f.emit(EXTENSION_VIEW_MODULE, "1", { type: "windowClose" });
  assert.equal(events.length, 2);
});

test("a popup closed while its native surface is still being created is released once the id arrives", async () => {
  const f = nativeSurfaces();
  const release = f.hold();
  const events = [];
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP }, (event) => events.push(event));
  view.viewport({ rect: { x: 1, y: 2, width: 3, height: 4 }, visible: true });
  view.dispose();
  release();
  await view.ready;
  await settle();
  assert.deepEqual(f.requests.map((r) => r.method), ["extensionView.create", "extensionView.release"]);
  assert.equal(f.live.size, 0);
  assert.deepEqual(events, []);
  await assert.rejects(view.command("focus"), /released/);
});

test("viewports are serialized after creation and identical ones are not resent", async () => {
  const f = nativeSurfaces();
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP }, () => {});
  const rect = { x: 10, y: 20, width: 300, height: 200 };
  await Promise.all([view.viewport({ rect, visible: false }), view.viewport({ rect, visible: false }), view.viewport({ rect, visible: true, occlusions: [rect] })]);
  const viewports = f.requests.filter((r) => r.method === "extensionView.viewport");
  assert.deepEqual(viewports.map((r) => r.args), [{ id: 1, rect, visible: false }, { id: 1, rect, visible: true }]);
  assert.equal(await view.command("evaluate", ["1 + 1"]), null);
  assert.deepEqual(f.requests.at(-1), { method: "extensionView.command", args: { id: 1, command: "evaluate", args: ["1 + 1"] } });
  view.dispose();
});

test("a popup asked for focus before it is shown takes focus right after its first visible viewport, once", async () => {
  const f = nativeSurfaces();
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP }, () => {});
  const rect = { x: 900, y: 48, width: 241, height: 121 };
  const sent = () => f.requests.filter((r) => r.method !== "extensionView.create").map((r) => (r.method === "extensionView.command" ? r.args.command : `viewport ${r.args.visible}`));
  await view.command("focus");
  await view.viewport({ rect, visible: false });
  await view.command("focus");
  assert.deepEqual(sent(), ["viewport false"]);
  await view.viewport({ rect, visible: true });
  assert.deepEqual(sent(), ["viewport false", "viewport true", "focus"]);
  await view.viewport({ rect: { ...rect, x: 901 }, visible: true });
  assert.deepEqual(sent(), ["viewport false", "viewport true", "focus", "viewport true"]);
  await view.command("focus");
  assert.deepEqual(sent(), ["viewport false", "viewport true", "focus", "viewport true", "focus"]);
  await view.viewport({ rect, visible: false });
  await view.command("focus");
  await view.viewport({ rect, visible: true });
  assert.deepEqual(sent().slice(5), ["viewport false", "viewport true", "focus"]);
  view.dispose();
});

test("a deferred popup focus is dropped when focus moved elsewhere in the window, or once it is stale", async () => {
  const f = nativeSurfaces();
  let active = "sidebar";
  let documentFocused = true;
  let now = 0;
  const witness = { current: () => [active, documentFocused], now: () => now };
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP }, () => {}, witness);
  const rect = { x: 900, y: 48, width: 241, height: 121 };
  const focuses = () => f.requests.filter((r) => r.method === "extensionView.command" && r.args.command === "focus").length;
  const show = (x) => view.viewport({ rect: { ...rect, x }, visible: true });
  const hide = (x) => view.viewport({ rect: { ...rect, x }, visible: false });
  await hide(1);
  await view.command("focus");
  active = "address field";
  await show(2);
  assert.equal(focuses(), 0);
  await hide(3);
  await view.command("focus");
  documentFocused = false;
  await show(4);
  assert.equal(focuses(), 0);
  documentFocused = true;
  await hide(5);
  await view.command("focus");
  now += 1501;
  await show(6);
  assert.equal(focuses(), 0);
  await hide(7);
  await view.command("focus");
  now += 1500;
  await show(8);
  assert.equal(focuses(), 1);
  view.dispose();
});

test("a stale native surface rejects later calls and a failed viewport is retried with the same geometry", async () => {
  const f = nativeSurfaces();
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP }, () => {});
  await view.ready;
  f.live.clear();
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  await assert.rejects(view.viewport({ rect, visible: true }), /No such extension view/);
  f.live.add(1);
  await view.viewport({ rect, visible: true });
  assert.equal(f.requests.filter((r) => r.method === "extensionView.viewport").length, 2);
  view.dispose();
});

test("a refused surface rejects ready and stops listening", async () => {
  const f = nativeSurfaces();
  f.fail(Object.assign(new Error("Extension views are unavailable in private windows"), { code: "ERR_PROFILE_PRIVATE" }));
  const view = new HostExtensionView(f.host, { kind: "popup", url: POPUP, profile: "default" }, () => {});
  await assert.rejects(view.ready, /private windows/);
  await settle();
  assert.equal(f.listeners.size, 0);
  view.dispose();
  await settle();
  assert.deepEqual(f.requests.map((r) => r.method), ["extensionView.create"]);
});

test("the shared extension domain reaches the native host as typed extensions.* calls", async () => {
  const f = nativeSurfaces();
  const call = resolveHostModule(f.host, "ArdiaExtensions", "call");
  await call("list", "", "{}");
  await call("actionStates", "", JSON.stringify({ tabId: "tab-1", ids: [ID] }));
  const search = resolveHostModule(f.host, "ArdiaSearch", "call");
  await search("engines", "", "{}");
  assert.deepEqual(f.calls, [
    { name: "extensions.list", profile: "default", args: "{}" },
    { name: "extensions.actionStates", profile: "default", args: JSON.stringify({ tabId: "tab-1", ids: [ID] }) },
    { name: "search.engines", profile: "default", args: "{}" },
  ]);
});

test("toolbar activation runs the extension action as a command on the owning tab", async () => {
  const requests = [];
  const host = {
    bootstrap: { windowId: "main", profileId: "default" },
    onEvent: () => () => {},
    async invoke(method, args) {
      requests.push({ method, args });
      if (method === "tab.create") return { browserId: 4, chromeTabId: 4 };
      if (method === "tab.command") return "popup";
      return null;
    },
  };
  const tab = new HostTab(host, { key: "tab-1" }, () => {});
  assert.equal(await tab.command("executeExtensionAction", [ID]), "popup");
  assert.deepEqual(requests.at(-1).args, { id: 4, claim: tab.claim, command: "executeExtensionAction", args: [ID] });
  tab.dispose();
});

test("a page in the popup's window taking focus closes the extension popup and still reaches the page's own handler", async () => {
  const { closingPopupOnPageFocus } = await import("./popupDismissal.ts");
  const windows = { "main-tab-0": "main", "spare-tab-0": "spare" };
  let popup = { windowId: "main", extensionId: ID };
  const closed = [];
  const focused = [];
  const props = (tabId) => closingPopupOnPageFocus({ tabId, onPageFocus: () => focused.push(tabId) }, () => popup, (id) => windows[id], () => { closed.push(popup.windowId); popup = null; });
  props("spare-tab-0").onPageFocus();
  assert.deepEqual(closed, []);
  props("main-tab-0").onPageFocus();
  assert.deepEqual(closed, ["main"]);
  props("main-tab-0").onPageFocus();
  assert.deepEqual(closed, ["main"]);
  assert.deepEqual(focused, ["spare-tab-0", "main-tab-0", "main-tab-0"]);
  popup = { windowId: "main", extensionId: ID };
  closingPopupOnPageFocus({}, () => popup, (id) => windows[id], () => closed.push("untracked")).onPageFocus();
  assert.deepEqual(closed, ["main"]);
});
