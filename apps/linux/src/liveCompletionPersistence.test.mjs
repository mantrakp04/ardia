import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { projectLiveIntent } from "./liveDocumentIntent.ts";

const platform = new URL("../../browser/src/platform/livePersistence.ts", import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); return result.url === platform ? { url: new URL("./livePersistence.ts", import.meta.url).href, shortCircuit: true } : result; } });
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const item = { id: "i", source: "github", url: "https://example.test/item", title: "Item", subtitle: "", icon: null, updatedAt: 0 };
const folder = (id) => ({ id, profileId: "p", kind: "pullRequests", name: id, icon: null, collapsed: false, sources: ["github"], filters: { authored: true, reviewRequests: true }, groupStacks: true, showCompleted: true, createdAt: 0 });
let payload = { folders: {}, folderOrder: [], items: {}, known: {}, unread: {}, hidden: {}, completed: {}, accounts: {}, expandedStacks: {}, config: {}, calendar: { hiddenCalendarIds: [] }, meetingGroups: {}, dismissedAlerts: [], version: 1 }, revision = 0, watermark = 0, generation = 0, generations = {}, incarnations = {}, mode = "accept", heldReply, heldCleanup;
const requests = [], listeners = new Set(), receipts = new Map();
const snapshot = () => structuredClone({ document: "live.json", scope: "scope", epoch: "epoch", clientId: "a", revision, watermark, payload, incarnations, generations });
const emit = (clientId = "peer", requestId = "peer:1") => { for (const listener of listeners) listener("ArdiaDocuments", "documents", { name: "documents.changed", data: { snapshot: snapshot(), clientId, requestId } }); };
const host = {
  bootstrap: { windowId: "window", profileId: "default" },
  onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async call(name, profile, json) {
    const request = JSON.parse(json);
    if (name === "documents.watch" || name === "documents.flush") return JSON.stringify(snapshot());
    assert.equal(name, "documents.commit"); requests.push(request);
    if (receipts.has(request.requestId)) return JSON.stringify(receipts.get(request.requestId));
    assert.equal(request.requestId, `a:${watermark + 1}`);
    const operation = request.operations[0];
    if (heldCleanup && operation.type === "refresh" && !operation.orders) { const gate = heldCleanup; heldCleanup = undefined; gate.started.resolve(); await gate.promise; }
    let superseded = false;
    if (operation.type === "claim") generations[operation.id] = ++generation;
    else if (operation.type === "refresh") {
      if (mode === "reject") throw Object.assign(new Error("Fixture write failure"), { code: "ERR_DOCUMENT_STORAGE" });
      superseded = mode === "superseded" || operation.generation !== generations[operation.id] || operation.incarnation !== incarnations[operation.id] || operation.owner !== "a";
      if (!superseded) { payload = projectLiveIntent(payload, request.operations); generations[operation.id] = ++generation; }
    } else {
      payload = projectLiveIntent(payload, request.operations);
      for (const operation of request.operations) if (operation.id && generations[operation.id] !== undefined) generations[operation.id] = ++generation;
    }
    watermark++; revision++;
    const response = { status: "committed", requestId: request.requestId, superseded, snapshot: snapshot() };
    receipts.set(request.requestId, response);
    emit("a", request.requestId);
    if (mode === "lose" && operation.type === "refresh") { mode = "accept"; throw new Error("Lost refresh reply"); }
    if (heldReply && operation.type === "refresh") { const gate = heldReply; heldReply = undefined; await gate.promise; }
    return JSON.stringify(response);
  },
};
globalThis.window = { __ardiaHost: host };
const { live, updateFolder } = await import("../../browser/src/state/live/store.ts");
const { refreshFolder, COMPLETION_MS } = await import("../../browser/src/state/live/engine.ts");
const { SOURCES } = await import("../../browser/src/state/live/sources.ts");
const { flushLinuxDocuments } = await import("./documentFlush.ts");
SOURCES.github.fetch = async () => [];
SOURCES.github.resolveGone = async () => ({ i: "closed" });

async function reset(ids = ["f"]) {
  mode = "accept";
  await flushLinuxDocuments();
  payload = { folders: Object.fromEntries(ids.map((id) => [id, folder(id)])), folderOrder: ids, items: Object.fromEntries(ids.map((id) => [id, [item]])), known: Object.fromEntries(ids.map((id) => [id, ["i"]])), unread: {}, hidden: {}, completed: {}, accounts: {}, expandedStacks: {}, config: {}, calendar: { hiddenCalendarIds: [] }, meetingGroups: {}, dismissedAlerts: [], version: 1 };
  incarnations = Object.fromEntries(ids.map((id) => [id, `incarnation:${id}:${++generation}`]));
  generations = Object.fromEntries(ids.map((id) => [id, ++generation])); revision++;
  requests.splice(0); emit();
}

for (const behavior of ["superseded", "reject", "lose"]) test(`real engine timer cannot delete canonical item after ${behavior} refresh`, async (context) => {
  await reset(); context.mock.timers.enable({ apis: ["setTimeout"] });
  mode = behavior;
  await refreshFolder("f");
  if (behavior === "superseded") await flushLinuxDocuments();
  else await assert.rejects(flushLinuxDocuments());
  assert.deepEqual(live().completing.f, []);
  context.mock.timers.tick(COMPLETION_MS);
  mode = "accept"; await flushLinuxDocuments();
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  assert.equal(requests.filter((request) => request.operations[0].type === "refresh" && !request.operations[0].orders).length, 0);
  assert.equal(requests.some((request) => request.operations[0].type === "entry"), false);
});

test("accepted completion timer uses acknowledged native generation and retains completed entry", async (context) => {
  await reset(); context.mock.timers.enable({ apis: ["setTimeout"] });
  await refreshFolder("f"); await flushLinuxDocuments();
  const acceptedGeneration = generations.f;
  assert.deepEqual(live().completing.f, ["i"]);
  context.mock.timers.tick(COMPLETION_MS - 1);
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  context.mock.timers.tick(1); await flushLinuxDocuments();
  assert.deepEqual(payload.items.f, []);
  assert.equal(payload.completed.f[0].item.id, "i");
  const cleanup = requests.at(-1).operations[0];
  assert.equal(cleanup.type, "refresh"); assert.equal(cleanup.generation, acceptedGeneration);
  assert.equal(cleanup.owner, "a"); assert.equal(cleanup.incarnation, incarnations.f);
});

test("event before held reply cannot authorize its completion timer", async (context) => {
  await reset(); context.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = deferred(); heldReply = gate;
  await refreshFolder("f"); await turn();
  assert.deepEqual(live().completing.f, ["i"]);
  context.mock.timers.tick(COMPLETION_MS);
  assert.deepEqual(live().completing.f, []);
  gate.resolve(); await flushLinuxDocuments();
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  assert.equal(requests.filter((request) => request.operations[0].type === "refresh").length, 1);
});

test("overlapping refresh timers and identical IDs in another folder keep separate origins", async (context) => {
  await reset(["f", "g"]); context.mock.timers.enable({ apis: ["setTimeout"] });
  await refreshFolder("f"); await flushLinuxDocuments();
  context.mock.timers.tick(1000);
  await refreshFolder("f"); await flushLinuxDocuments();
  await refreshFolder("g"); await flushLinuxDocuments();
  assert.deepEqual(live().completing.f, ["i"]); assert.deepEqual(live().completing.g, ["i"]);
  context.mock.timers.tick(COMPLETION_MS - 1000);
  assert.deepEqual(live().completing.f, ["i"]); assert.deepEqual(live().completing.g, ["i"]);
  updateFolder("f", { name: "changed" }); await flushLinuxDocuments();
  assert.deepEqual(live().completing.f, []); assert.deepEqual(live().completing.g, ["i"]);
  context.mock.timers.tick(1000); await flushLinuxDocuments();
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  assert.deepEqual(payload.items.g, []);
});

test("delete and recreate incarnation invalidates old completion without touching new item", async (context) => {
  await reset(); context.mock.timers.enable({ apis: ["setTimeout"] });
  await refreshFolder("f"); await flushLinuxDocuments();
  delete payload.folders.f; delete payload.items.f; payload.folderOrder = []; delete incarnations.f; delete generations.f; revision++; emit();
  payload.folders.f = folder("f"); payload.folderOrder = ["f"]; payload.items.f = [item]; payload.completed.f = [];
  incarnations.f = "new-incarnation"; generations.f = ++generation; revision++; emit();
  const count = requests.length;
  context.mock.timers.tick(COMPLETION_MS); await flushLinuxDocuments();
  assert.equal(requests.length, count); assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
});

test("configuration change during real fetch supersedes completion before its timer", async (context) => {
  await reset(); context.mock.timers.enable({ apis: ["setTimeout"] });
  const started = deferred(), fetched = deferred();
  SOURCES.github.fetch = async () => { started.resolve(); await fetched.promise; return []; };
  try {
    const refresh = refreshFolder("f"); await started.promise;
    updateFolder("f", { filters: { authored: false, reviewRequests: true } }); await flushLinuxDocuments();
    fetched.resolve(); await refresh; await flushLinuxDocuments();
    assert.deepEqual(live().completing.f, []);
    const count = requests.length; context.mock.timers.tick(COMPLETION_MS); await flushLinuxDocuments();
    assert.equal(requests.length, count); assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
    assert.equal(payload.folders.f.filters.authored, false);
  } finally { SOURCES.github.fetch = async () => []; fetched.resolve(); }
});

test("generation change after cleanup submission is checked by the native refresh fence", async (context) => {
  await reset(); context.mock.timers.enable({ apis: ["setTimeout"] });
  await refreshFolder("f"); await flushLinuxDocuments();
  const gate = deferred(); gate.started = deferred(); heldCleanup = gate;
  context.mock.timers.tick(COMPLETION_MS); await gate.started.promise;
  generations.f = ++generation; payload.folders.f.name = "peer changed"; revision++; emit();
  gate.resolve(); await flushLinuxDocuments();
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  assert.equal(payload.folders.f.name, "peer changed");
  assert.equal(requests.at(-1).operations[0].type, "refresh");
});
