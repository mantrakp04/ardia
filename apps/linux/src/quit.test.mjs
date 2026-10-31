import assert from "node:assert/strict";
import test from "node:test";
import { createHostDialogs } from "./hostDialogs.ts";
import { QUIT_LOCK, createHostQuit, createLinuxQuit, downloadsWarning, quitWarning } from "./quit.ts";

const { useBrowser } = await import("../../browser/src/state/browser/store.ts");
const state = () => useBrowser.getState();
const turn = () => new Promise(setImmediate);
const capabilities = ["ArdiaShell.windowIdentity", "ArdiaShell.beginDialog", "ArdiaShell.cancelDialog", "ArdiaShell.downloadsInProgress", "ArdiaShell.quit"];

function fixture({ downloads = 0, supported = capabilities } = {}) {
  state().hydrate({});
  const windowId = state().createWindow({ url: "https://one.test" });
  const listeners = new Set(), requests = [];
  const host = {
    bootstrap: { windowId, profileId: "default", capabilities: supported },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invoke(method, payload) {
      requests.push({ method, ...payload });
      if (method === "ArdiaShell.windowIdentity") return { windowId, rendererGeneration: "1" };
      if (method === "ArdiaShell.downloadsInProgress") return downloads;
      if (method === "ArdiaShell.quit") return null;
      return { accepted: true };
    },
  };
  const dialogs = createHostDialogs(host);
  const quit = createHostQuit(host, (options) => dialogs.confirm(options));
  const asked = () => requests.filter((r) => r.method === "ArdiaShell.beginDialog").map((r) => r.args[0].options);
  const respond = async (result) => {
    for (let i = 0; i < 20 && !requests.some((r) => r.method === "ArdiaShell.beginDialog" && !r.answered); i++) await turn();
    const request = requests.find((r) => r.method === "ArdiaShell.beginDialog" && !r.answered);
    assert(request, "no open quit prompt");
    request.answered = true;
    const { dialogId } = request.args[0];
    for (const listener of listeners) listener("ArdiaShell", "shell", { name: "shell.dialogResolved", data: { dialogId, windowId, rendererGeneration: "1", result } });
  };
  const quits = () => requests.filter((r) => r.method === "ArdiaShell.quit").length;
  return { quit, asked, respond, quits, requests, retire: () => dialogs.retire() };
}

test("with the setting on, one owned prompt asks with Quit, Cancel and Don't ask again; Cancel keeps Ardia open", async () => {
  const f = fixture();
  state().updateSettings({ warnBeforeQuitting: true });
  const attempt = f.quit();
  await f.respond({ confirmed: false, suppressed: false });
  assert.equal(await attempt, "cancelled");
  assert.equal(f.asked().length, 1);
  assert.equal(f.asked()[0].title, "Are you sure you want to quit Ardia?");
  assert.equal(f.asked()[0].message, "Your windows and tabs will be restored the next time you open it.");
  assert.equal(f.asked()[0].confirmTitle, "Quit");
  assert.equal(f.asked()[0].suppression, "Don't ask again");
  assert.equal(f.quits(), 0);
  assert.equal(state().settings.warnBeforeQuitting, true);
  f.retire();
});

test("Quit on the warning quits once through the host", async () => {
  const f = fixture();
  state().updateSettings({ warnBeforeQuitting: true });
  const attempt = f.quit();
  await f.respond({ confirmed: true, suppressed: false });
  assert.equal(await attempt, "quitting");
  assert.equal(f.quits(), 1);
  assert.equal(f.requests.find((r) => r.method === "ArdiaShell.quit").args.length, 0);
  assert.equal(state().settings.warnBeforeQuitting, true);
  f.retire();
});

test("Don't ask again turns the setting off whether the answer is Quit or Cancel", async () => {
  for (const confirmed of [true, false]) {
    const f = fixture();
    state().updateSettings({ warnBeforeQuitting: true });
    const attempt = f.quit();
    await f.respond({ confirmed, suppressed: true });
    assert.equal(await attempt, confirmed ? "quitting" : "cancelled");
    assert.equal(state().settings.warnBeforeQuitting, false);
    assert.equal(f.quits(), confirmed ? 1 : 0);
    f.retire();
  }
});

test("with the setting off and nothing downloading, quitting asks nothing", async () => {
  const f = fixture();
  state().updateSettings({ warnBeforeQuitting: false });
  assert.equal(await f.quit(), "quitting");
  assert.deepEqual(f.asked(), []);
  assert.equal(f.quits(), 1);
  f.retire();
});

test("active downloads ask before quitting with macOS's wording, after the quit warning", async () => {
  assert.equal(downloadsWarning("Ardia", 1).message, "You have 1 download in progress. If you quit now, this download will be cancelled.");
  assert.equal(downloadsWarning("Ardia", 3).message, "You have 3 downloads in progress. If you quit now, these downloads will be cancelled.");
  assert.equal(downloadsWarning("Ardia", 3).suppression, undefined);
  const f = fixture({ downloads: 2 });
  state().updateSettings({ warnBeforeQuitting: true });
  const attempt = f.quit();
  await f.respond({ confirmed: true, suppressed: false });
  await f.respond({ confirmed: false, suppressed: false });
  assert.equal(await attempt, "cancelled");
  assert.deepEqual(f.asked().map((options) => options.message), [quitWarning("Ardia").message, downloadsWarning("Ardia", 2).message]);
  assert.equal(f.asked()[1].confirmTitle, "Quit");
  assert.equal(f.quits(), 0);
  const again = f.quit();
  await f.respond({ confirmed: true, suppressed: false });
  await f.respond({ confirmed: true, suppressed: false });
  assert.equal(await again, "quitting");
  assert.equal(f.quits(), 1);
  f.retire();
});

test("pressing quit again while the prompt is open shows no second prompt", async () => {
  const f = fixture();
  state().updateSettings({ warnBeforeQuitting: true });
  const first = f.quit();
  const second = f.quit();
  assert.equal(first, second);
  await f.respond({ confirmed: true, suppressed: false });
  assert.equal(await first, "quitting");
  assert.equal(f.asked().length, 1);
  assert.equal(f.quits(), 1);
  f.retire();
});

test("a quit already being asked about in another window is not asked again", async () => {
  const requested = [];
  const quit = createLinuxQuit({
    appName: () => "Ardia",
    warnBeforeQuitting: () => true,
    stopWarning: () => assert.fail("no prompt"),
    ask: async () => assert.fail("no prompt"),
    downloadsInProgress: async () => 0,
    quit: async () => assert.fail("no quit"),
    locks: { request: (name, options, callback) => (requested.push([name, options]), callback(null)) },
  });
  assert.equal(await quit(), "busy");
  assert.deepEqual(requested, [[QUIT_LOCK, { ifAvailable: true }]]);
});

test("a host without the quit route says so and never pretends to quit", async () => {
  const f = fixture({ supported: capabilities.filter((method) => method !== "ArdiaShell.quit") });
  state().updateSettings({ warnBeforeQuitting: false });
  await assert.rejects(f.quit(), (error) => error.code === "ERR_UNAVAILABLE");
  assert.equal(f.quits(), 0);
  f.retire();
});

test("an unreadable download count fails closed", async () => {
  const f = fixture({ downloads: "two" });
  state().updateSettings({ warnBeforeQuitting: false });
  await assert.rejects(f.quit(), (error) => error.code === "ERR_QUIT");
  assert.equal(f.quits(), 0);
  f.retire();
});
