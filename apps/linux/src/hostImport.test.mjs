import assert from "node:assert/strict";
import test from "node:test";
import { CHOOSER_DEADLINE_MS, IMPORT_IDLE_MS, createHostImport, pendingPasswords } from "./hostImport.ts";
import { applyPendingPasswords, applyResult, setImportPasswordSink } from "./importApply.ts";
import { claimImportHandle, isImportHandle, issueImportHandles } from "./importHandles.ts";
import { savePassword } from "./importedPasswordSave.ts";
import { randomBytes } from "node:crypto";

class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ImportError";
  }
}

const TOKEN = randomBytes(16).toString("hex");

function fixture({ capabilities = [], replies = {} } = {}) {
  const listeners = new Set();
  const calls = [];
  const timers = [];
  const host = {
    bootstrap: { windowId: "import", profileId: "default", capabilities },
    call: async () => "null",
    invoke: async (method, { args }) => {
      calls.push({ method, args });
      const reply = replies[method];
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(args) : reply ?? true;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const clock = {
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.live = false;
    },
  };
  const emit = (payload, module = "ArdiaImport", event = "onImportEvent") => {
    for (const listener of [...listeners]) listener(module, event, payload);
  };
  const fire = (ms) => {
    for (const timer of timers.filter((t) => t.live && t.ms === ms)) {
      timer.live = false;
      timer.run();
    }
  };
  const api = createHostImport(host, ImportError, clock);
  return { api, calls, emit, fire, listeners, timers };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const native = (code, message = code) => Object.assign(new Error(message), { code });

test("listBrowsers keeps well-formed Linux sources and remembers which can decrypt passwords", async () => {
  const sources = [
    { id: "chrome", name: "Google Chrome", family: "chromium", profiles: [] },
    { id: "firefox", name: "Firefox", family: "firefox", profiles: [] },
    { id: "safari", name: "Safari", family: "safari", profiles: [] },
    { id: 3, name: "bad", family: "chromium", profiles: [] },
    null,
  ];
  const { api, calls } = fixture({ replies: { "ArdiaImport.listBrowsers": sources } });
  assert.deepEqual((await api.listBrowsers()).map((s) => s.id), ["chrome", "firefox"]);
  assert.deepEqual(calls, [{ method: "ArdiaImport.listBrowsers", args: [] }]);
  assert.equal(api.isBrowserUnlocked("chrome"), true);
  assert.equal(api.isBrowserUnlocked("firefox"), false);
  await api.unlockBrowser("chrome");
  await assert.rejects(api.unlockBrowser("safari"), { code: "unsupported" });
  const broken = fixture({ replies: { "ArdiaImport.listBrowsers": { not: "a list" } } });
  await assert.rejects(broken.api.listBrowsers(), { code: "unreadable" });
  const failing = fixture({ replies: { "ArdiaImport.listBrowsers": native("ERR_ENGINE", "Unsupported Linux host method") } });
  await assert.rejects(failing.api.listBrowsers(), { code: "unreadable" });
});

test("importData starts a native job, maps only its own progress and resolves a normalized result", async () => {
  const { api, calls, emit, listeners } = fixture();
  const progress = [];
  const running = api.importData("chrome", "Default", ["bookmarks", "passwords"], { historyLimit: 10, onProgress: (p) => progress.push(p) });
  await settle();
  const [start] = calls;
  assert.equal(start.method, "ArdiaImport.startImport");
  const [jobId, ...rest] = start.args;
  assert.match(jobId, /^import-import-\d+$/);
  assert.deepEqual(rest, ["chrome", "Default", ["bookmarks", "passwords"], { historyLimit: 10, historySince: undefined }]);
  emit({ jobId: "someone-else", type: "progress", kind: "history", phase: "start", processed: 0 });
  emit({ jobId, type: "progress", kind: "bookmarks", phase: "start", processed: 0 }, "ArdiaShell");
  emit({ jobId, type: "progress", kind: "bookmarks", phase: "start", processed: 0 });
  emit({ jobId, type: "progress", kind: "bookmarks", phase: "bogus", processed: 0 });
  emit({ jobId, type: "progress", kind: "bookmarks", phase: "end", processed: 4, total: 4 });
  emit({ jobId, type: "done", result: {
    browserId: "chrome", profileId: "Default", bookmarks: { type: "folder", title: "Bookmarks", children: [] },
    history: [], historyCount: 0, credentials: [{ url: "https://x", username: "u", password: "leak" }], vaultToken: "nope",
    failed: [], warnings: [{ kind: "passwords", code: "undecryptable", message: "1 password couldn't be decrypted" }],
    passwords: { token: TOKEN, count: 3 },
  } });
  const result = await running;
  assert.deepEqual(progress, [
    { kind: "bookmarks", phase: "start", processed: 0, total: undefined },
    { kind: "bookmarks", phase: "end", processed: 4, total: 4 },
  ]);
  assert.deepEqual(result.credentials, []);
  assert.equal(result.vaultToken, undefined);
  assert.deepEqual(result.tabs, []);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(pendingPasswords(result), { token: TOKEN, count: 3 });
  assert.equal(listeners.size, 0);
});

test("importData streams history in chunks when asked", async () => {
  const { api, calls, emit } = fixture();
  const chunks = [];
  const running = api.importData("chrome", "Default", ["history"], { chunkSize: 2, onHistoryChunk: (c) => chunks.push(c.map((e) => e.url)) });
  await settle();
  const history = ["a", "b", "c"].map((url) => ({ url, title: url, visits: 1, lastVisit: 1 }));
  emit({ jobId: calls[0].args[0], type: "done", result: { history, historyCount: 3 } });
  const result = await running;
  assert.deepEqual(chunks, [["a", "b"], ["c"]]);
  assert.deepEqual(result.history, []);
  assert.equal(result.historyCount, 3);
});

test("native failures, start errors and stalls reject with their codes and stop listening", async () => {
  const failed = fixture();
  const running = failed.api.importData("chrome", "Default", ["history"]);
  await settle();
  failed.emit({ jobId: failed.calls[0].args[0], type: "failed", code: "notFound", message: "Profile not found" });
  await assert.rejects(running, { code: "notFound", message: "Profile not found" });
  assert.equal(failed.listeners.size, 0);

  const refused = fixture({ replies: { "ArdiaImport.startImport": native("busy", "That import is already running") } });
  await assert.rejects(refused.api.importData("chrome", "Default", ["history"]), { code: "busy" });
  assert.equal(refused.listeners.size, 0);

  const stalled = fixture();
  const waiting = stalled.api.importData("chrome", "Default", ["history"]);
  await settle();
  const jobId = stalled.calls[0].args[0];
  stalled.emit({ jobId, type: "progress", kind: "history", phase: "start", processed: 0 });
  stalled.fire(IMPORT_IDLE_MS);
  await assert.rejects(waiting, { code: "timeout" });
  await settle();
  assert.deepEqual(stalled.calls.at(-1), { method: "ArdiaImport.cancelImport", args: [jobId] });
  assert.equal(stalled.listeners.size, 0);
});

test("cancelling an import cancels the native job and discards a password token that arrives late", async () => {
  const { api, calls, emit, listeners } = fixture();
  const controller = new AbortController();
  const running = api.importData("chrome", "Default", ["passwords"], { signal: controller.signal });
  await settle();
  const jobId = calls[0].args[0];
  controller.abort();
  await assert.rejects(running, { code: "cancelled" });
  await settle();
  assert.deepEqual(calls[1], { method: "ArdiaImport.cancelImport", args: [jobId] });
  emit({ jobId, type: "done", result: { passwords: { token: TOKEN, count: 1 } } });
  await settle();
  assert.deepEqual(calls[2], { method: "ArdiaImport.discardPasswords", args: [TOKEN] });
  assert.equal(listeners.size, 0);

  const already = new AbortController();
  already.abort();
  const before = calls.length;
  await assert.rejects(api.importData("chrome", "Default", ["history"], { signal: already.signal }), { code: "cancelled" });
  assert.equal(calls.length, before);
});

test("the file chooser resolves the chosen path, null on cancel, and reports a policy-disabled chooser", async () => {
  const { api, calls, emit, fire, listeners } = fixture();
  const choosing = api.chooseImportFile("bookmarksHTML");
  await settle();
  assert.equal(calls[0].method, "ArdiaImport.chooseImportFile");
  const [requestId, kind] = calls[0].args;
  assert.equal(kind, "bookmarksHTML");
  emit({ jobId: requestId, type: "progress" });
  emit({ jobId: requestId, type: "chosen", path: "/home/me/bookmarks.html" });
  assert.equal(await choosing, "/home/me/bookmarks.html");
  assert.equal(listeners.size, 0);

  const cancelled = api.chooseImportFile("passwordsCSV");
  await settle();
  emit({ jobId: calls[1].args[0], type: "chosen", path: null });
  assert.equal(await cancelled, null);

  const relative = api.chooseImportFile("passwordsCSV");
  await settle();
  emit({ jobId: calls[2].args[0], type: "chosen", path: "relative.csv" });
  assert.equal(await relative, null);

  const abandoned = api.chooseImportFile("bookmarksHTML");
  await settle();
  const abandonedId = calls[3].args[0];
  fire(CHOOSER_DEADLINE_MS);
  assert.equal(await abandoned, null);
  await settle();
  assert.deepEqual(calls[4], { method: "ArdiaImport.cancelChooser", args: [abandonedId] });

  assert.equal(await api.chooseImportFile("safariExport"), null);
  assert.equal(calls.length, 5);

  const disabled = fixture({ replies: { "ArdiaImport.chooseImportFile": native("ERR_FILE_CHOOSER_DISABLED") } });
  await assert.rejects(disabled.api.chooseImportFile("bookmarksHTML"), { code: "ERR_FILE_CHOOSER_DISABLED" });
  assert.equal(disabled.listeners.size, 0);
});

test("bookmark HTML returns the parsed tree and passes native error codes through", async () => {
  const root = { type: "folder", title: "Bookmarks", children: [{ type: "url", title: "A", url: "https://a.example/" }] };
  const { api, calls } = fixture({ replies: { "ArdiaImport.importBookmarksHTML": { root, links: 1 } } });
  assert.deepEqual(await api.importBookmarksHTML("/home/me/b.html"), root);
  assert.deepEqual(calls[0], { method: "ArdiaImport.importBookmarksHTML", args: ["/home/me/b.html"] });
  const notChosen = fixture({ replies: { "ArdiaImport.importBookmarksHTML": native("ERR_FILE_NOT_CHOSEN") } });
  await assert.rejects(notChosen.api.importBookmarksHTML("/etc/passwd"), { code: "ERR_FILE_NOT_CHOSEN" });
  const empty = fixture({ replies: { "ArdiaImport.importBookmarksHTML": native("empty", "The file has no bookmarks") } });
  await assert.rejects(empty.api.importBookmarksHTML("/home/me/empty.html"), { code: "empty" });
});

test("CSV passwords stay native: the pane gets one-time handles and the first save writes into its profile", async () => {
  const reply = { passwords: { token: TOKEN, count: 3 }, entries: [
    { url: "https://a.example/", username: "a" }, { url: "https://b.example/", username: "b" }, { url: "https://c.example/", username: "c" },
  ], rows: 4, duplicates: 1, invalid: 0 };
  const { api, calls, emit } = fixture({ replies: { "ArdiaImport.importPasswordsCSV": reply } });
  const rows = await api.importPasswordsCSV("/home/me/p.csv");
  assert.deepEqual(rows.map((r) => [r.url, r.username]), [["https://a.example/", "a"], ["https://b.example/", "b"], ["https://c.example/", "c"]]);
  assert.ok(rows.every((r) => isImportHandle(r.password)));
  assert.equal(new Set(rows.map((r) => r.password)).size, 3);
  assert.equal(isImportHandle("hunter2"), false);
  const claims = rows.map((r) => claimImportHandle(r.password, "work"));
  await settle();
  const writes = calls.filter((c) => c.method === "ArdiaImport.writePasswords");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args.slice(1), [TOKEN, "work"]);
  emit({ jobId: writes[0].args[0], type: "written", added: 2, existing: 1, conflicts: 0, invalid: 0 });
  assert.deepEqual(await Promise.all(claims), [true, true, false]);
  assert.equal(await claimImportHandle(rows[0].password, "work"), false);
  const none = fixture({ replies: { "ArdiaImport.importPasswordsCSV": { entries: [], rows: 1, duplicates: 0, invalid: 1 } } });
  assert.deepEqual(await none.api.importPasswordsCSV("/home/me/bad.csv"), []);
});

test("password tokens are written in event-completed chunks with added and existing counts", async () => {
  const { api, calls, emit, fire, listeners } = fixture();
  const writing = api.writePasswords(TOKEN, "");
  await settle();
  const [request, token, profile] = calls[0].args;
  assert.equal(calls[0].method, "ArdiaImport.writePasswords");
  assert.deepEqual([token, profile], [TOKEN, ""]);
  emit({ jobId: request, type: "progress", kind: "passwords", phase: "progress", processed: 500, total: 7000 });
  emit({ jobId: request, type: "written", added: 6000, existing: 990, conflicts: 10, invalid: "x" });
  assert.deepEqual(await writing, { added: 6000, existing: 990, conflicts: 10, invalid: 0 });
  assert.equal(listeners.size, 0);
  api.discardPasswords(TOKEN);
  api.forgetUnlockedKeys();
  await settle();
  assert.deepEqual(calls.slice(1).map((c) => c.method), ["ArdiaImport.discardPasswords", "ArdiaImport.forgetUnlockedKeys"]);

  const expired = fixture({ replies: { "ArdiaImport.writePasswords": native("expired") } });
  await assert.rejects(expired.api.writePasswords(TOKEN, ""), { code: "expired" });
  const refused = fixture();
  const refusing = refused.api.writePasswords(TOKEN, "work");
  await settle();
  refused.emit({ jobId: refused.calls[0].args[0], type: "failed", code: "ERR_PROFILE_UNAVAILABLE", message: "no" });
  await assert.rejects(refusing, { code: "ERR_PROFILE_UNAVAILABLE" });
  const stalled = fixture();
  const stalling = stalled.api.writePasswords(TOKEN, "");
  await settle();
  stalled.fire(IMPORT_IDLE_MS);
  await assert.rejects(stalling, { code: "timeout" });
});

test("Safari and Dia report unsupported instead of succeeding", async () => {
  const { api, calls } = fixture();
  assert.equal(api.safariHasFullDiskAccess(), false);
  for (const attempt of [api.importSafariExport("/x"), api.importSafariDirect(), api.openFullDiskAccessSettings(), api.readDiaTabs()]) {
    await assert.rejects(attempt, { code: "unsupported" });
  }
  api.discardImported("t");
  assert.deepEqual(calls, []);
});

test("pendingPasswords only accepts a well-formed token", () => {
  assert.equal(pendingPasswords(null), null);
  assert.equal(pendingPasswords({ passwords: { token: "short", count: 1 } }), null);
  assert.equal(pendingPasswords({ passwords: { token: TOKEN.toUpperCase(), count: 1 } }), null);
  assert.deepEqual(pendingPasswords({ passwords: { token: TOKEN, count: -2 } }), { token: TOKEN, count: 0 });
});

function sink(reply) {
  const log = [];
  return {
    log,
    pending: pendingPasswords,
    write: async (token, profile) => {
      log.push(["write", token, profile]);
      if (reply instanceof Error) throw reply;
      return reply;
    },
    discard: (token) => log.push(["discard", token]),
  };
}

test("applyPendingPasswords writes requested passwords to the engine profile and fails closed elsewhere", async () => {
  const result = { passwords: { token: TOKEN, count: 2 } };
  const failed = [];
  const written = sink({ added: 2, existing: 5, conflicts: 0, invalid: 0 });
  assert.equal(await applyPendingPasswords(written, "default", result, ["passwords"], (k) => failed.push(k)), 2);
  assert.deepEqual(written.log, [["write", TOKEN, ""]]);

  const unrequested = sink({ imported: 2 });
  assert.equal(await applyPendingPasswords(unrequested, "default", result, ["bookmarks"]), 0);
  assert.deepEqual(unrequested.log, [["discard", TOKEN]]);

  const incognito = sink({ imported: 2 });
  assert.equal(await applyPendingPasswords(incognito, "incognito:w1@default", result, ["passwords"], (k) => failed.push(k)), 0);
  assert.deepEqual(incognito.log, [["discard", TOKEN]]);

  const refused = sink(native("ERR_PROFILE_UNAVAILABLE"));
  assert.equal(await applyPendingPasswords(refused, "work", result, ["passwords"], (k) => failed.push(k)), 0);
  assert.deepEqual(refused.log, [["write", TOKEN, "work"]]);
  assert.deepEqual(failed, ["passwords", "passwords"]);

  const none = sink({ imported: 9 });
  assert.equal(await applyPendingPasswords(none, "default", {}, ["passwords"]), 0);
  assert.deepEqual(none.log, []);
});

test("the Linux applyResult adds natively written passwords to the shared counts", async () => {
  const result = { browserId: "chrome", profileId: "Default", history: [], historyCount: 0, tabs: [], tabGroups: [], credentials: [],
    cookieCount: 0, addressCount: 0, cardCount: 0, spaces: [], favorites: [], favicons: [], failed: [], warnings: [], passwords: { token: TOKEN, count: 3 } };
  const written = sink({ added: 3, existing: 0, conflicts: 0, invalid: 0 });
  setImportPasswordSink(written);
  try {
    const counts = await applyResult("default", result, "Google Chrome", ["passwords"]);
    assert.equal(counts.passwords, 3);
    assert.deepEqual(written.log, [["write", TOKEN, ""]]);
  } finally {
    setImportPasswordSink(null);
  }
  const failed = [];
  const counts = await applyResult("default", result, "Google Chrome", ["passwords"], (k) => failed.push(k));
  assert.equal(counts.passwords, 0);
  assert.deepEqual(failed, ["passwords"]);
});

test("the Passwords pane's savePassword claims import handles instead of saving them as passwords", async () => {
  const writes = [];
  const [row] = issueImportHandles(TOKEN, [{ url: "https://a.example/", username: "a" }], async (token, profile) => {
    writes.push([token, profile]);
    return { added: 1 };
  });
  assert.equal(await savePassword("work", "https://a.example", "a", row.password), true);
  assert.deepEqual(writes, [[TOKEN, "work"]]);
  assert.equal(await savePassword("work", "https://a.example", "a", row.password).catch(() => "shared"), "shared");
});
