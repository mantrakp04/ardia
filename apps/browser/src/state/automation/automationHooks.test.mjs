import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { startAutomation } = await import("./controlSocket.ts");
const { noteCommit } = await import("./automationEvents.ts");
const { reloadHooks, useHookRules } = await import("./hookRules.ts");
const { approveRule, pendingRules, resetApprovalsForTests } = await import("./approvals.ts");
const { approvalFor } = await import("./hookPolicy.ts");
const { usePages, patchPage } = await import("../tabs/pageState.ts");
const { noteNotificationShown } = await import("./notificationEvents.ts");
const { openExternalUrls } = await import("../littleArdia/actions.ts");
const { useRegisteredProviders } = await import("../omnibox/providers.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextId = 0;
let nextConnection = 500;

async function controlOn() {
  S().updateSettings({ cliControl: true });
  startAutomation();
  for (let i = 0; i < 5 && !stub.controlSocket.running; i++) await tick();
  await tick();
}

function call(method, params, connection) {
  const id = ++nextId;
  const before = stub.controlSocket.replies.length;
  stub.emitControlRequest({ connection, generation: stub.controlSocket.generation, line: JSON.stringify({ id, method, params }) });
  const replies = stub.controlSocket.replies.slice(before).filter((r) => r.connection === connection);
  assert.equal(replies.length, 1, `one reply to ${method}`);
  return JSON.parse(replies[0].line);
}

const linesFor = (connection, from) => stub.controlSocket.broadcasts.slice(from).filter((b) => b.connections.includes(connection)).map((b) => JSON.parse(b.line));
const eventsFor = (connection, from) => linesFor(connection, from).filter((l) => l.event && !l.decide);

function setHooks(hooks) {
  stub.configFolder.files.set("hooks.json", JSON.stringify({ hooks }));
  reloadHooks();
  return useHookRules.getState().hooks;
}

function dl(d) {
  S().upsertDownload(d);
  stub.emitDownload(d);
}

function fresh(hooks = []) {
  S().hydrate({});
  S().updateSettings({ cliControl: true });
  resetApprovalsForTests();
  setHooks(hooks);
}

test("app.launched replays once per connection; * leaves out presence and notification events", async () => {
  fresh();
  await controlOn();
  const a = ++nextConnection;
  const from = stub.controlSocket.broadcasts.length;
  call("subscribe", { events: ["*"] }, a);
  await tick();
  call("subscribe", { events: ["*"] }, a);
  await tick();
  const launches = eventsFor(a, from).filter((e) => e.event === "app.launched");
  assert.equal(launches.length, 1);
  assert.deepEqual(Object.keys(launches[0].data).sort(), ["focusedWindowId", "launchId", "restored", "windows"]);
  const b = ++nextConnection;
  call("subscribe", { events: ["app.launched"] }, b);
  await tick();
  assert.equal(eventsFor(b, from).find((e) => e.event === "app.launched").data.launchId, launches[0].data.launchId);
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  const mark = stub.controlSocket.broadcasts.length;
  noteNotificationShown(t, { origin: "https://a.example", title: "Hi", body: "secret body" });
  assert.equal(eventsFor(a, mark).length, 0);
  const c = ++nextConnection;
  call("subscribe", { events: ["notification.shown"] }, c);
  noteNotificationShown(t, { origin: "https://a.example", title: "Hi", body: "x".repeat(2000) });
  const shown = eventsFor(c, mark).find((e) => e.event === "notification.shown");
  assert.equal(shown.data.body.length, 500);
  for (const conn of [a, b, c]) stub.emitControlClose(conn);
});

test("URLs lose their query and fragment unless the subscriber asks for full URLs", async () => {
  fresh();
  await controlOn();
  const plain = ++nextConnection;
  const full = ++nextConnection;
  call("subscribe", { events: ["tab.opened"] }, plain);
  call("subscribe", { events: ["tab.opened"], fullUrls: true }, full);
  const from = stub.controlSocket.broadcasts.length;
  S().createWindow({ url: "https://a.example/p?token=1#x" });
  assert.equal(eventsFor(plain, from)[0].data.url, "https://a.example/p");
  assert.equal(eventsFor(full, from)[0].data.url, "https://a.example/p?token=1#x");
  stub.emitControlClose(plain);
  stub.emitControlClose(full);
});

test("run takes a tab without focusing it; a closed, private or wrong-window tab is an error", async () => {
  fresh();
  await controlOn();
  const conn = ++nextConnection;
  const w = S().createWindow({ url: "https://a.example/" });
  const other = S().newTab(w, { url: "https://b.example/", background: true });
  const active = model.activeTabId(S(), w);
  assert.deepEqual(call("run", { command: "toggleMute", tab: other }, conn).result, { ok: true });
  assert.equal(S().tabs[other].muted, true);
  assert.equal(model.activeTabId(S(), w), active);
  assert.equal(call("run", { command: "newWindow", tab: other }, conn).error.code, "bad_request");
  assert.equal(call("run", { command: "toggleMute", tab: other, window: "nope" }, conn).error.code, "no_window");
  const priv = S().createWindow({ kind: "private", url: "https://secret.example/" });
  assert.equal(call("run", { command: "toggleMute", tab: model.activeTabId(S(), priv) }, conn).error.code, "no_window");
  S().closeTab(other);
  assert.equal(call("run", { command: "toggleMute", tab: other }, conn).error.code, "no_window");
});

test("store events: pins, moves, media, splits, crashes and page errors once per document", async () => {
  fresh();
  await controlOn();
  const conn = ++nextConnection;
  call("subscribe", { events: ["pin.added", "pin.removed", "tab.moved", "media.started", "media.stopped", "tab.crashed", "page.error", "profile.switched"] }, conn);
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  const from = stub.controlSocket.broadcasts.length;
  S().togglePin(t);
  S().togglePin(t);
  S().updateLive(t, { playingAudio: true });
  S().updateLive(t, { playingAudio: false });
  patchPage(t, { crashed: { status: 1, reason: "crashed", code: 1 } });
  const at = Date.now() + 1000;
  noteCommit(t, "https://a.example/missing?q=1", at, 404);
  noteCommit(t, "https://a.example/missing?q=1#same", at, 404);
  noteCommit(t, "https://a.example/ok", at + 1, 200);
  await wait(150);
  const names = eventsFor(conn, from).map((e) => e.event);
  assert.deepEqual(names, ["pin.added", "pin.removed", "media.started", "media.stopped", "tab.crashed", "page.error"]);
  const error = eventsFor(conn, from).find((e) => e.event === "page.error");
  assert.deepEqual([error.data.url, error.data.status], ["https://a.example/missing", 404]);
  usePages.setState({ pages: {} });
  stub.emitControlClose(conn);
});

test("declarative tab.opening rules work with control off; cross-origin rewrites wait for approval", async () => {
  const hooks = [
    { name: "strip", on: "tab.opening", match: "https://track.example/*", rewrite: [{ match: "https://track.example/*", to: "{origin}{path}" }] },
    { name: "old-reddit", on: "tab.opening", rewrite: [{ match: "https://www.reddit.com/*", to: "https://old.reddit.com{path}" }] },
    { name: "block", on: "tab.opening", match: "https://blocked.example/*", cancel: true },
  ];
  fresh(hooks);
  S().updateSettings({ cliControl: false });
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  S().navigate(t, "https://track.example/page?utm_source=x");
  assert.equal(S().tabs[t].page.nav?.url ?? S().tabs[t].url, "https://track.example/page");
  S().navigate(t, "https://www.reddit.com/r/x");
  assert.equal(S().tabs[t].page.nav.url, "https://www.reddit.com/r/x");
  assert.ok(pendingRules().some((r) => r.name === "old-reddit"));
  approveRule(approvalFor(useHookRules.getState().hooks[1]).key);
  S().navigate(t, "https://www.reddit.com/r/y");
  assert.equal(S().tabs[t].page.nav.url, "https://old.reddit.com/r/y");
  const before = S().tabs[t].page.nav.url;
  S().navigate(t, "https://blocked.example/");
  assert.equal(S().tabs[t].page.nav.url, before);
  const count = Object.keys(S().tabs).length;
  assert.equal(S().newTab(w, { url: "https://blocked.example/x" }), "");
  assert.equal(Object.keys(S().tabs).length, count);
});

test("a program decide hook goes only to the runner that serves it; foreign, duplicate and late answers are refused", async () => {
  const hooks = [{ name: "prog", on: "tab.opening", run: ["~/bin/decide"] }];
  fresh(hooks);
  await controlOn();
  approveRule(approvalFor(useHookRules.getState().hooks[0]).key);
  const runner = ++nextConnection;
  const watcher = ++nextConnection;
  assert.deepEqual(call("subscribe", { events: ["tab.opened"], hooks: [{ name: "prog", on: "tab.opening", run: ["~/bin/other"] }] }, runner).result.served, []);
  assert.deepEqual(call("subscribe", { events: ["tab.opened"], hooks }, runner).result.served, ["prog"]);
  call("subscribe", { events: ["*"] }, watcher);
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  const from = stub.controlSocket.broadcasts.length;
  S().navigate(t, "https://b.example/one");
  assert.equal(S().tabs[t].page.nav?.url === "https://b.example/one", false);
  const request = linesFor(runner, from).find((l) => l.decide);
  assert.equal(request.event, "tab.opening");
  assert.equal(request.deadline, 250);
  assert.equal(linesFor(watcher, from).some((l) => l.decide), false);
  assert.equal(call("answer", { decide: request.decide, answer: { url: "https://c.example/" } }, watcher).error.code, "bad_request");
  assert.deepEqual(call("answer", { decide: request.decide, answer: { url: "https://c.example/" } }, runner).result, { ok: true });
  assert.equal(call("answer", { decide: request.decide, answer: { url: "https://d.example/" } }, runner).error.code, "bad_request");
  await tick();
  assert.equal(S().tabs[t].page.nav.url, "https://c.example/");

  const late = stub.controlSocket.broadcasts.length;
  S().navigate(t, "https://b.example/two");
  const second = linesFor(runner, late).find((l) => l.decide);
  await wait(300);
  assert.equal(S().tabs[t].page.nav.url, "https://b.example/two");
  assert.ok(linesFor(runner, late).some((l) => l.decide === second.decide && l.cancel === true));
  assert.equal(call("answer", { decide: second.decide, answer: { cancel: true } }, runner).error.code, "bad_request");

  stub.emitControlClose(runner);
  S().navigate(t, "https://b.example/three");
  assert.equal(S().tabs[t].page.nav.url, "https://b.example/three");
  stub.emitControlClose(watcher);
});

test("permission hooks only deny or leave the normal prompt, and never remember", async () => {
  fresh([
    { name: "no-camera", on: "permission.requested", match: "https://cam.example/*", kinds: ["camera"], permission: "deny" },
    { name: "allow-mic", on: "permission.requested", permission: "allow" },
  ]);
  const w = S().createWindow({ url: "https://cam.example/" });
  const t = model.activeTabId(S(), w);
  const { startPermissionPrompts } = await import("../site/permissions.ts");
  startPermissionPrompts();
  stub.resolvedPermissions.length = 0;
  stub.emitPermission({ id: "p1", tabId: t, origin: "https://cam.example", permissions: ["camera"] });
  await tick();
  assert.deepEqual(stub.resolvedPermissions, [{ id: "p1", result: "deny", remember: false }]);
  stub.emitPermission({ id: "p2", tabId: t, origin: "https://cam.example", permissions: ["microphone"] });
  await tick();
  assert.equal(usePages.getState().pages[t]?.permission?.id, "p2");
  assert.equal(stub.resolvedPermissions.length, 1);
});

test("link.opening routes or drops links from other apps before any tab exists", async () => {
  fresh([
    { name: "drop-ads", on: "link.opening", match: "https://ads.example/*", drop: true },
    { name: "slack-work", on: "link.opening", from: ["com.tinyspeck.slackmacgap"], route: { open: "tab" } },
  ]);
  approveRule(approvalFor(useHookRules.getState().hooks[1]).key);
  S().updateSettings({ openLinksInLittleArdia: true });
  const w = S().createWindow({ url: "https://a.example/" });
  const tabs = () => Object.keys(S().tabs).length;
  const before = tabs();
  openExternalUrls(["https://ads.example/x"], undefined, { bundleId: "com.apple.mail", appName: "Mail" });
  await wait(20);
  assert.equal(tabs(), before);
  openExternalUrls(["https://news.example/"], undefined, { bundleId: "com.tinyspeck.slackmacgap", appName: "Slack" });
  await wait(20);
  assert.ok(Object.values(S().tabs).some((t) => t.url === "https://news.example/" && t.windowId === w));
  assert.equal(Object.values(S().windows).filter((x) => x.kind === "small").length, 0);
});

test("an approved omnibox hook becomes a provider only while its runner serves it", async () => {
  const hooks = [{ name: "jira", omnibox: { title: "Jira", keyword: "j" }, run: ["~/bin/jira"] }];
  fresh(hooks);
  await controlOn();
  const runner = ++nextConnection;
  call("subscribe", { events: ["tab.opened"], hooks }, runner);
  assert.equal(useRegisteredProviders.getState().list.some((p) => p.id === "hook:jira"), false);
  approveRule(approvalFor(useHookRules.getState().hooks[0]).key);
  const provider = useRegisteredProviders.getState().list.find((p) => p.id === "hook:jira");
  assert.equal(provider.keyword, "j");
  const from = stub.controlSocket.broadcasts.length;
  const rows = provider.query("ABC-1", new AbortController().signal);
  const request = linesFor(runner, from).find((l) => l.decide);
  assert.deepEqual(request.data, { text: "ABC-1", keyword: "j" });
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, url: `https://jira.example/${i}` }));
  call("answer", { decide: request.decide, answer: [{ title: "bad", url: "javascript:1" }, ...many] }, runner);
  assert.equal((await rows).length, 8);
  const aborted = new AbortController();
  const cancelled = provider.query("x", aborted.signal);
  aborted.abort();
  assert.deepEqual(await cancelled, []);
  stub.emitControlClose(runner);
  assert.equal(useRegisteredProviders.getState().list.some((p) => p.id === "hook:jira"), false);
});

test("download.deciding fires when a download finishes; a folder rule moves it, anything else leaves it", async () => {
  const { startDownloadHooks, resetDownloadHooksForTests } = await import("./downloadHooks.ts");
  fresh([
    { name: "invoices", on: "download.deciding", match: "https://billing.example/*", folder: "~/Downloads/Invoices" },
    { name: "finance", on: "download.deciding", match: "https://bank.example/*", folder: "~/Documents/Finance" },
  ]);
  resetDownloadHooksForTests();
  const moves = [];
  const approved = [];
  startDownloadHooks({
    move: async (path, folder) => (moves.push([path, folder]), { ok: true, path: `/Users/me/${folder.slice(2)}/${path.split("/").pop()}` }),
    approveFolders: (folders) => approved.push(folders),
  });
  assert.deepEqual(approved.at(-1), []);
  const base = { received: 10, total: 10, speed: 0, mimeType: "application/pdf", paused: false, profile: "" };
  const finish = (id, url) => {
    dl({ ...base, id, url, filename: `${id}.pdf`, path: `/Users/me/Downloads/${id}.pdf`, state: "downloading" });
    dl({ ...base, id, url, filename: `${id}.pdf`, path: `/Users/me/Downloads/${id}.pdf`, state: "finished" });
  };
  finish("d1", "https://billing.example/inv.pdf");
  finish("d2", "https://bank.example/stmt.pdf");
  finish("d3", "https://other.example/x.pdf");
  await wait(10);
  assert.deepEqual(moves, [["/Users/me/Downloads/d1.pdf", "~/Downloads/Invoices"]]);
  assert.equal(S().downloads.find((d) => d.id === "d1").path, "/Users/me/Downloads/Invoices/d1.pdf");
  approveRule(approvalFor(useHookRules.getState().hooks[1]).key);
  assert.deepEqual(approved.at(-1), ["~/Documents/Finance"]);
  finish("d4", "https://bank.example/stmt2.pdf");
  await wait(10);
  assert.deepEqual(moves.at(-1), ["/Users/me/Downloads/d4.pdf", "~/Documents/Finance"]);
  dl({ ...S().downloads.find((d) => d.id === "d1"), received: 11 });
  await wait(10);
  assert.equal(moves.length, 2);
  resetDownloadHooksForTests();
});

test("a program download hook that times out leaves the file where it is", async () => {
  const { startDownloadHooks, resetDownloadHooksForTests } = await import("./downloadHooks.ts");
  const hooks = [{ name: "sorter", on: "download.deciding", run: ["~/bin/sort"] }];
  fresh(hooks);
  await controlOn();
  approveRule(approvalFor(useHookRules.getState().hooks[0]).key);
  const runner = ++nextConnection;
  call("subscribe", { events: ["tab.opened"], hooks }, runner);
  resetDownloadHooksForTests();
  const moves = [];
  startDownloadHooks({ move: async (path, folder) => (moves.push([path, folder]), { ok: true, path }), approveFolders: () => {} });
  const from = stub.controlSocket.broadcasts.length;
  const d = { id: "p1", url: "https://a.example/f.zip", filename: "f.zip", path: "/Users/me/Downloads/f.zip", received: 5, total: 5, speed: 0, mimeType: "application/zip", paused: false, profile: "", state: "finished" };
  dl({ ...d, state: "downloading" });
  dl(d);
  const request = linesFor(runner, from).find((l) => l.decide);
  assert.deepEqual(request.data, { url: d.url, origin: "https://a.example", filename: "f.zip", mime: "application/zip", size: 5, path: d.path, profile: "" });
  assert.equal(request.deadline, 2000);
  call("answer", { decide: request.decide, answer: { folder: "/etc" } }, runner);
  await wait(10);
  assert.deepEqual(moves, []);
  stub.emitControlClose(runner);
  resetDownloadHooksForTests();
});

test("a rewritten new-tab link reuses the engine's prepared contents; a cancelled one opens nothing", async () => {
  const { openFromPage } = await import("../tabs/openFromPage.ts");
  fresh([
    { name: "block", on: "tab.opening", match: "https://blocked.example/*", cancel: true },
    { name: "strip", on: "tab.opening", match: "https://track.example/*", rewrite: [{ match: "https://track.example/*", to: "{origin}{path}" }] },
  ]);
  const w = S().createWindow({ url: "https://a.example/" });
  const from = model.activeTabId(S(), w);
  const page = { windowId: w, profileId: S().windows[w].profileId, tabId: from };
  const count = Object.keys(S().tabs).length;
  openFromPage({ url: "https://blocked.example/x", disposition: "foreground", adoptId: "tab:41" }, page);
  assert.equal(Object.keys(S().tabs).length, count);
  assert.ok(stub.discardedOffers.includes("tab:41"));
  openFromPage({ url: "https://track.example/p?utm=1", disposition: "foreground", adoptId: "tab:42" }, page);
  const opened = Object.values(S().tabs).filter((t) => t.page.kind === "adopted" && t.page.adopt === "tab:42");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].page.nav.url, "https://track.example/p");
  assert.equal(opened[0].page.nav.userInitiated, undefined);
  assert.equal(Object.keys(S().tabs).length, count + 1);
});

test("only downloads that progress during this launch are decided; history replays are left alone", async () => {
  const { resetDownloadHooksForTests, startDownloadHooks } = await import("./downloadHooks.ts");
  fresh([{ name: "all", on: "download.deciding", folder: "~/Downloads/Sorted" }]);
  resetDownloadHooksForTests();
  const base = { url: "http://127.0.0.1:18800/x.bin", received: 2048, total: 2048, speed: 0, mimeType: "application/octet-stream", paused: false, profile: "" };
  const moves = [];
  startDownloadHooks({ move: async (path, folder) => (moves.push([path, folder]), { ok: true, path }), approveFolders: () => {} });
  stub.emitDownload({ ...base, id: "history-guid", filename: "old.bin", path: "/Users/me/Downloads/old.bin", state: "finished" });
  stub.emitDownload({ ...base, id: "other-profile", filename: "older.bin", path: "/Users/me/Downloads/older.bin", state: "finished", profile: "work" });
  stub.emitDownload({ ...base, id: "fast", filename: "", path: "", state: "downloading", received: 0 });
  stub.emitDownload({ ...base, id: "fast", filename: "fast.bin", path: "/Users/me/Downloads/fast.bin", state: "finished" });
  stub.emitDownload({ ...base, id: "fast", filename: "fast.bin", path: "/Users/me/Downloads/fast.bin", state: "finished" });
  stub.emitDownload({ ...base, id: "dropped", filename: "d.bin", path: "", state: "downloading" });
  stub.emitDownload({ ...base, id: "dropped", filename: "d.bin", path: "", state: "cancelled" });
  await wait(10);
  assert.deepEqual(moves, [["/Users/me/Downloads/fast.bin", "~/Downloads/Sorted"]]);
  resetDownloadHooksForTests();
});

test("the app's download hooks use the native mover and pass it the approved folders", async () => {
  const { resetDownloadHooksForTests, startDownloadHooks } = await import("./downloadHooks.ts");
  const { moveCompletedDownload, setApprovedDownloadFolders } = await import("../../platform/systemSignals.ts");
  fresh([{ name: "invoices", on: "download.deciding", match: "https://billing.example/*", folder: "~/Downloads/Invoices" }, { name: "fin", on: "download.deciding", match: "https://bank.example/*", folder: "~/Documents/Finance" }]);
  resetDownloadHooksForTests();
  startDownloadHooks({ move: moveCompletedDownload, approveFolders: setApprovedDownloadFolders });
  assert.deepEqual(stub.systemSignals.approvedDownloadFolders, []);
  approveRule(approvalFor(useHookRules.getState().hooks[1]).key);
  assert.deepEqual(stub.systemSignals.approvedDownloadFolders, ["~/Documents/Finance"]);
  stub.systemSignals.moves.length = 0;
  stub.systemSignals.moveResult = { ok: false, reason: "folderMissing" };
  const d = { id: "n1", url: "https://billing.example/a.pdf", filename: "a.pdf", path: "/Users/me/Downloads/a.pdf", received: 1, total: 1, speed: 0, mimeType: "application/pdf", paused: false, profile: "" };
  dl({ ...d, state: "downloading" });
  dl({ ...d, state: "finished" });
  await wait(10);
  assert.deepEqual(stub.systemSignals.moves, [{ path: d.path, folder: "~/Downloads/Invoices" }]);
  assert.equal(S().downloads.find((x) => x.id === "n1").path, d.path);
  resetDownloadHooksForTests();
});

test("decide data is trimmed per hook; invalidation sends a cancel and refuses later answers", async () => {
  const hooks = [
    { name: "plain", on: "tab.opening", match: "https://p.example/*", run: ["~/bin/a"] },
    { name: "full", on: "tab.opening", match: "https://f.example/*", run: ["~/bin/b"], fullUrls: true },
  ];
  fresh(hooks);
  await controlOn();
  for (const h of useHookRules.getState().hooks) approveRule(approvalFor(h).key);
  const runner = ++nextConnection;
  assert.deepEqual(call("subscribe", { events: ["tab.opened"], hooks }, runner).result.revisions, Object.fromEntries(useHookRules.getState().hooks.map((h) => [h.name, h.revision])));
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  const from = stub.controlSocket.broadcasts.length;
  S().navigate(t, "https://p.example/x?token=secret#frag");
  const plain = linesFor(runner, from).find((l) => l.decide && l.hook === "plain");
  assert.equal(plain.data.url, "https://p.example/x");
  const other = S().newTab(w, { url: "https://a.example/2", gated: true });
  const mark = stub.controlSocket.broadcasts.length;
  S().navigate(other, "https://f.example/y?token=1");
  const full = linesFor(runner, mark).find((l) => l.decide && l.hook === "full");
  assert.equal(full.data.url, "https://f.example/y?token=1");

  const before = stub.controlSocket.broadcasts.length;
  call("subscribe", { events: ["tab.opened"], hooks }, runner);
  const cancels = linesFor(runner, before).filter((l) => l.cancel === true).map((l) => l.decide).sort();
  assert.deepEqual(cancels, [full.decide, plain.decide].sort());
  assert.equal(call("answer", { decide: plain.decide, answer: { url: "https://z.example/" } }, runner).error.code, "bad_request");
  await tick();
  assert.equal(S().tabs[t].page.nav.url, "https://p.example/x?token=secret#frag");

  const again = stub.controlSocket.broadcasts.length;
  S().navigate(t, "https://p.example/again");
  const pendingOne = linesFor(runner, again).find((l) => l.decide);
  setHooks([...hooks, { name: "extra", on: "tab.opened", run: ["x"] }]);
  assert.ok(linesFor(runner, again).some((l) => l.decide === pendingOne.decide && l.cancel === true));
  assert.equal(call("answer", { decide: pendingOne.decide, answer: null }, runner).error.code, "bad_request");
  stub.emitControlClose(runner);
});

test("an explicit tab target runs before Peek and the command panel, and a missing target is an error", async () => {
  fresh();
  await controlOn();
  const conn = ++nextConnection;
  const w = S().createWindow({ url: "https://a.example/" });
  const shown = model.activeTabId(S(), w);
  const background = S().newTab(w, { url: "https://b.example/", background: true });
  const peek = S().openPeek(shown, "https://peek.example/");
  S().openPanel(w, "");
  assert.deepEqual(call("run", { command: "closeTab", tab: background }, conn).result, { ok: true });
  assert.equal(S().tabs[background], undefined);
  assert.equal(S().peeks[w]?.tabId, peek);
  assert.equal(S().windowUi[w].panel.open, true);
  assert.equal(call("run", { command: "closeTab", tab: background }, conn).error.code, "no_window");
  assert.equal(call("run", { command: "closeTab", tab: peek }, conn).error.code, "no_window");
  assert.equal(call("run", { command: "newWindow", tab: shown }, conn).error.code, "bad_request");
  const other = S().newTab(w, { url: "https://c.example/", background: true });
  assert.deepEqual(call("run", { command: "togglePin", tab: other }, conn).result, { ok: true });
  assert.ok(S().tabs[other].pin);
  assert.equal(S().tabs[shown].pin, null);
});

test("a rewritten navigation goes out as not user-initiated; an unchanged one keeps its value", async () => {
  fresh([{ name: "strip", on: "tab.opening", match: "https://track.example/*", rewrite: [{ match: "https://track.example/*", to: "{origin}{path}" }] }]);
  const w = S().createWindow({ url: "https://a.example/" });
  const t = model.activeTabId(S(), w);
  S().navigate(t, "https://track.example/p?utm=1");
  assert.deepEqual([S().tabs[t].page.nav.url, S().tabs[t].page.nav.userInitiated], ["https://track.example/p", undefined]);
  S().navigate(t, "https://track.example/q");
  assert.deepEqual([S().tabs[t].page.nav.url, S().tabs[t].page.nav.userInitiated], ["https://track.example/q", true]);
  const rewritten = S().newTab(w, { url: "https://track.example/n?utm=2" });
  assert.deepEqual([S().tabs[rewritten].page.nav.url, S().tabs[rewritten].page.nav.userInitiated, S().tabs[rewritten].profileId], ["https://track.example/n", undefined, S().windows[w].profileId]);
  const kept = S().newTab(w, { url: "https://track.example/m" });
  assert.equal(S().tabs[kept].page.nav.userInitiated, true);
});

test("a move that fails with the file left in staging keeps the record pointing at it", async () => {
  const { resetDownloadHooksForTests, startDownloadHooks } = await import("./downloadHooks.ts");
  fresh([{ name: "all", on: "download.deciding", folder: "~/Downloads/Sorted" }]);
  resetDownloadHooksForTests();
  const staged = "/Users/me/Downloads/.ardia-staging-1/s.bin";
  startDownloadHooks({ move: async () => ({ ok: false, reason: "failed", stagedPath: staged }), approveFolders: () => {} });
  const d = { id: "st", url: "https://a.example/s.bin", filename: "s.bin", path: "/Users/me/Downloads/s.bin", received: 1, total: 1, speed: 0, mimeType: "application/octet-stream", paused: false, profile: "" };
  dl({ ...d, state: "downloading" });
  dl({ ...d, state: "finished" });
  await wait(10);
  assert.equal(S().downloads.find((x) => x.id === "st").path, staged);
  resetDownloadHooksForTests();
});

test("the incoming-link hold follows whether an active tab.opening or link.opening hook exists", async () => {
  const { startDecideHooks } = await import("./decideHooks.ts");
  startDecideHooks();
  fresh([{ name: "drop", on: "link.opening", match: "https://ads.example/*", drop: true }]);
  assert.equal(stub.systemSignals.holdsIncomingLinks, true);
  setHooks([{ name: "watch", on: "tab.opened", run: ["x"] }]);
  assert.equal(stub.systemSignals.holdsIncomingLinks, false);
});

test("a tab target in Little Ardia runs there, with or without a main window, and unsupported commands are refused", async () => {
  fresh();
  await controlOn();
  S().updateSettings({ warnBeforeClosingLastTab: false });
  const { isWindowClosing } = await import("../windows/closeAnimated.ts");
  const closed = (windowId, tabId) => !S().tabs[tabId] || !S().windows[windowId] || isWindowClosing(windowId);
  const conn = ++nextConnection;
  const little = S().createWindow({ kind: "small", url: "https://l.example/" });
  const tab = model.activeTabId(S(), little);
  assert.equal(call("run", { command: "togglePin", tab }, conn).error.code, "bad_request");
  assert.deepEqual(call("run", { command: "reload", tab }, conn).result, { ok: true });
  assert.deepEqual(call("run", { command: "closeTab", tab }, conn).result, { ok: true });
  await wait(20);
  assert.ok(closed(little, tab));
  const main = S().createWindow({ url: "https://m.example/" });
  const little2 = S().createWindow({ kind: "small", url: "https://l2.example/" });
  const tab2 = model.activeTabId(S(), little2);
  S().setFocusedWindow(little2);
  assert.deepEqual(call("run", { command: "closeTab", tab: tab2 }, conn).result, { ok: true });
  await wait(20);
  assert.ok(closed(little2, tab2));
  assert.ok(S().windows[main]);
});
