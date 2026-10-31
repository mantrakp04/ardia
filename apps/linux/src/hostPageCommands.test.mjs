import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { HostTab } from "./hostTab.ts";
import { HostPageEvents } from "./hostPageEvents.ts";
import { WEB_STORE_REQUEST, hostPageScript } from "./hostPageScripts.ts";

const bootstrap = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/bootstrap.js", import.meta.url), "utf8");
const lease = (mount) => ({ claim: mount.claim, rendererGeneration: "1", bindingGeneration: String(mount.binding), documentEpoch: "1" });

function pageReceiver(props) {
  return (claim, nativeId, rebound) => new HostPageEvents(claim, nativeId, () => props, () => {}, () => {}, rebound);
}

function fixture() {
  const requests = [];
  const mounts = new Map();
  let nextTab = 6;
  let bindings = 0;
  const byId = new Map();
  let refusal;
  const context = {
    location: { protocol: "chrome:", hostname: "ardia" },
    crypto: { randomUUID },
    __ardiaBootstrap: { windowId: "commands", profileId: "default" },
    setTimeout, clearTimeout, addEventListener() {}, console,
    chrome: { send(name, [requestId, operation, payload]) {
      assert.equal(name, "ardiaRequest");
      assert.equal(operation, "host.invoke");
      const { method, args } = payload;
      requests.push({ method, args });
      if (method === "tab.create") {
        const previous = mounts.get(args.key);
        const id = previous?.id ?? ++nextTab;
        const mount = { id, claim: args.claim, binding: ++bindings, sequence: 1 };
        mounts.set(args.key, mount);
        byId.set(id, mount);
        context.__ardiaReply(requestId, true, { browserId: id, chromeTabId: id,
          lease: { ...lease(mount), type: "pageLease", sequence: 1 }, snapshot: { watermark: 1, events: [] } });
      } else if (refusal) context.__ardiaReply(requestId, false, refusal);
      else context.__ardiaReply(requestId, true, null);
    } },
  };
  context.window = context;
  context.top = context;
  runInNewContext(bootstrap, context);
  return {
    host: context.__ardiaHost, requests,
    refuse(error) { refusal = error; },
    emit(id, value) { context.__ardiaEvent("ArdiaWebView", String(id), { type: "findResult", value }); },
    find(id, value, mount = byId.get(id)) {
      context.__ardiaEvent("ArdiaWebView", String(id), { ...lease(mount), type: "pageEvent", sequence: ++mount.sequence, event: { name: "find", data: value } });
    },
    mount(id) { return byId.get(id); },
  };
}

const settle = () => new Promise(setImmediate);

test("page command contracts retain the exact pane, claim and arguments through the production transport", async () => {
  const f = fixture();
  const a = new HostTab(f.host, { key: "left" }, () => {});
  const b = new HostTab(f.host, { key: "right" }, () => {});
  await Promise.all([a.ready, b.ready]);
  try {
    const commands = [
      ["find", ["needle", true, false]], ["find", ["needle", true, true]],
      ["find", ["needle", false, true]], ["find", ["", true, false]],
      ["stopFinding", [false]], ["stopFinding", [true]], ["print", []],
      ["runPageCommand", ["savePage"]], ["runPageCommand", ["systemPrint"]],
      ["showDevTools", []], ["showDevTools", ["toggle"]],
      ["showDevTools", ["inspect"]], ["showDevTools", ["console"]],
    ];
    for (const [command, args] of commands) {
      assert.equal(await b.command(command, args), null);
      const request = f.requests.at(-1);
      assert.deepEqual(request, { method: "tab.command", args: { id: b.identity.browserId, claim: b.claim, command, args } });
      assert.notEqual(request.args.id, a.identity.browserId);
    }
  } finally {
    a.dispose(); b.dispose(); await settle();
  }
});

test("Find acknowledgements carry no result; separate events reach only their pane and current mount", async () => {
  const f = fixture();
  const left = [], old = [], replacement = [];
  const a = new HostTab(f.host, { key: "left" }, (event) => left.push(event));
  const b = new HostTab(f.host, { key: "right" }, (event) => old.push(event));
  await Promise.all([a.ready, b.ready]);
  assert.equal(await b.command("find", ["needle", true, false]), null);
  const result = { count: 4, active: 2, final: true };
  f.emit(b.identity.browserId, result);
  assert.deepEqual(old.filter((event) => event.type === "findResult"), [{ type: "findResult", value: result }]);
  assert.equal(left.filter((event) => event.type === "findResult").length, 0);
  const c = new HostTab(f.host, { key: "right" }, (event) => replacement.push(event));
  await c.ready;
  assert.equal(c.identity.browserId, b.identity.browserId);
  assert.notEqual(c.claim, b.claim);
  f.emit(c.identity.browserId, { count: 2, active: 1, final: false });
  assert.equal(old.filter((event) => event.type === "findResult").length, 1);
  assert.equal(replacement.filter((event) => event.type === "findResult").length, 1);
  await assert.rejects(b.command("find", ["stale", true, false]), /released/);
  a.dispose(); b.dispose(); c.dispose(); await settle();
  f.emit(c.identity.browserId, result);
  assert.equal(replacement.filter((event) => event.type === "findResult").length, 1);
});

test("structured refusals reject with stable codes without changing target or retrying", async () => {
  const f = fixture();
  const tab = new HostTab(f.host, { key: "target" }, () => {});
  await tab.ready;
  for (const [command, args, code] of [
    ["runPageCommand", ["caretBrowsing"], "ERR_PAGE_UNSUPPORTED"],
    ["print", [], "ERR_PAGE_POLICY"], ["showDevTools", [], "ERR_PAGE_UNAVAILABLE"],
    ["runPageCommand", ["savePage"], "ERR_PAGE_STALE_TARGET"],
  ]) {
    f.refuse({ code, message: "Page command refused" });
    const before = f.requests.length;
    await assert.rejects(tab.command(command, args), { code, message: "Page command refused" });
    assert.equal(f.requests.length, before + 1);
    assert.equal(f.requests.at(-1).args.id, tab.identity.browserId);
  }
  f.refuse(undefined);
  tab.dispose(); await settle();
});

test("native Find results reach the shared FindBar callback of only the exact pane", async () => {
  const f = fixture();
  const left = [], right = [];
  const a = new HostTab(f.host, { key: "left" }, () => {}, pageReceiver({ onFindResult: (value) => left.push(value) }));
  const b = new HostTab(f.host, { key: "right" }, () => {}, pageReceiver({ onFindResult: (value) => right.push(value) }));
  await Promise.all([a.ready, b.ready]);
  assert.equal(await b.command("find", ["needle", true, false]), null);
  f.find(b.identity.browserId, { count: 7, active: 3, final: false });
  f.find(b.identity.browserId, { count: 7, active: 4, final: true });
  assert.deepEqual(right, [{ count: 7, active: 3, final: false }, { count: 7, active: 4, final: true }]);
  assert.deepEqual(left, []);
  f.find(a.identity.browserId, { count: 0, active: 0, final: true });
  assert.deepEqual(left, [{ count: 0, active: 0, final: true }]);
  f.emit(b.identity.browserId, { count: 9, active: 9, final: true });
  f.find(b.identity.browserId, { count: 9, active: 9, final: true }, { ...f.mount(b.identity.browserId), claim: "intruder" });
  assert.equal(right.length, 2);
  a.dispose(); b.dispose(); await settle();
  f.find(b.identity.browserId, { count: 1, active: 1, final: true });
  assert.equal(right.length, 2);
});

test("a slow favicon download never holds back the tab's viewport or Find", async () => {
  const sent = [];
  const favicons = [];
  const host = {
    bootstrap: { windowId: "slow-favicon", profileId: "default" },
    onEvent: () => () => {},
    invoke(method, args) {
      sent.push(args.command ?? method);
      if (method === "tab.create") return Promise.resolve({ browserId: 9, chromeTabId: 9 });
      if (args.command === "downloadFavicon") return new Promise((resolve) => favicons.push(resolve));
      return Promise.resolve(null);
    },
  };
  const tab = new HostTab(host, { key: "slow-favicon" }, () => {});
  const favicon = tab.command("downloadFavicon", ["https://icons.test/favicon.ico"]);
  await tab.command("find", ["needle", true, false]);
  assert.deepEqual(sent, ["tab.create", "downloadFavicon", "find"]);
  favicons[0]("data:image/png;base64,");
  assert.equal(await favicon, "data:image/png;base64,");
  await tab.command("stopFinding", ["clear"]);
  assert.deepEqual(sent.slice(3), ["stopFinding"]);
});

test("a waiting Web Store request never holds back the tab's viewport, focus or other commands", async () => {
  const sent = [];
  const waits = [];
  const host = {
    bootstrap: { windowId: "store-wait", profileId: "default" },
    onEvent: () => () => {},
    invoke(method, args) {
      sent.push(args.command ?? method);
      if (method === "tab.create") return Promise.resolve({ browserId: 11, chromeTabId: 11 });
      if (args.command === "webStoreRequest") return new Promise((resolve) => waits.push(resolve));
      return Promise.resolve(null);
    },
  };
  const tab = new HostTab(host, { key: "store-wait" }, () => {});
  await tab.ready;
  const store = hostPageScript("evaluate", [WEB_STORE_REQUEST]);
  const request = tab.command(store.command, store.args);
  await Promise.resolve();
  const within = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} waited behind the store request`)), 1000).unref())]);
  await within(tab.viewport({ rect: { x: 0, y: 0, width: 100, height: 100 }, visible: false }), "the viewport");
  await within(tab.command("focus", []), "focus");
  assert.deepEqual(sent, ["tab.create", "webStoreRequest", "tab.viewport", "focus"]);
  waits[0]("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(await request, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("a viewport capture waiting for a frame never holds back hiding the page under a dialog", async () => {
  const sent = [];
  const captures = [];
  const host = {
    bootstrap: { windowId: "capture-wait", profileId: "default" },
    onEvent: () => () => {},
    invoke(method, args) {
      sent.push(args.command ?? method);
      if (method === "tab.create") return Promise.resolve({ browserId: 12, chromeTabId: 12 });
      if (args.command === "captureViewport") return new Promise((resolve) => captures.push(resolve));
      return Promise.resolve(null);
    },
  };
  const tab = new HostTab(host, { key: "capture-wait" }, () => {});
  await tab.ready;
  const capture = tab.command("captureViewport", []);
  await Promise.resolve();
  const within = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} waited behind the capture`)), 1000).unref())]);
  await within(tab.viewport({ rect: { x: 0, y: 0, width: 100, height: 100 }, visible: false }), "hiding the page");
  assert.deepEqual(sent, ["tab.create", "captureViewport", "tab.viewport"]);
  captures[0]("data:image/png;base64,");
  assert.equal(await capture, "data:image/png;base64,");
});
