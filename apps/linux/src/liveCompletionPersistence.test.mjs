import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { projectLiveIntent } from "./liveDocumentIntent.ts";

const platform = new URL("../../browser/src/platform/livePersistence.ts", import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); return result.url === platform ? { url: new URL("./livePersistence.ts", import.meta.url).href, shortCircuit: true } : result; } });
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const item = { id: "i", source: "github", url: "https://example.test/item", title: "Item", subtitle: "", icon: null, updatedAt: 0 };
const folder = { id: "f", profileId: "p", kind: "pullRequests", name: "f", icon: null, collapsed: false, sources: ["github"], filters: { authored: true, reviewRequests: true }, groupStacks: true, showCompleted: true, createdAt: 0 };
const liveDocument = (seeded) => ({ folders: seeded ? { f: folder } : {}, folderOrder: seeded ? ["f"] : [], items: seeded ? { f: [item] } : {}, known: seeded ? { f: ["i"] } : {}, unread: {}, hidden: {}, completed: {}, accounts: {}, expandedStacks: {}, config: {}, calendar: { hiddenCalendarIds: [] }, meetingGroups: {}, dismissedAlerts: [], version: 1 });
let payload = liveDocument(false), revision = 0, watermark = 0, generation = 0, generations = {}, incarnations = {}, mode = "accept", heldReply;
const requests = [], listeners = new Set(), receipts = new Map();
const snapshot = () => structuredClone({ document: "live.json", scope: "scope", epoch: "epoch", clientId: "a", revision, watermark, payload, incarnations, generations });
const emit = (clientId = "peer", requestId = "peer:1") => { for (const listener of listeners) listener("ArdiaDocuments", "documents", { name: "documents.changed", data: { snapshot: snapshot(), clientId, requestId } }); };
const host = {
  bootstrap: { windowId: "window", profileId: "default" },
  onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async call(name, profile, json) {
    const request = JSON.parse(json);
    if (name !== "documents.commit") return JSON.stringify(snapshot());
    requests.push(request);
    if (receipts.has(request.requestId)) return JSON.stringify(receipts.get(request.requestId));
    const operation = request.operations[0];
    let superseded = false;
    if (operation.type === "refresh") {
      if (mode === "reject") throw Object.assign(new Error("Fixture write failure"), { code: "ERR_DOCUMENT_STORAGE" });
      superseded = mode === "superseded" || operation.generation !== generations[operation.id] || operation.incarnation !== incarnations[operation.id] || operation.owner !== "a";
      if (!superseded) { payload = projectLiveIntent(payload, request.operations); generations[operation.id] = ++generation; }
    } else if (operation.type === "claim") generations[operation.id] = ++generation;
    else payload = projectLiveIntent(payload, request.operations);
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
const { live } = await import("../../browser/src/state/live/store.ts");
const { refreshFolder, COMPLETION_MS } = await import("../../browser/src/state/live/engine.ts");
const { SOURCES } = await import("../../browser/src/state/live/sources.ts");
const { flushLinuxDocuments } = await import("./documentFlush.ts");
SOURCES.github.fetch = async () => [];
SOURCES.github.resolveGone = async () => ({ i: "closed" });

async function reset(context) {
  mode = "accept";
  await flushLinuxDocuments();
  payload = liveDocument(true);
  incarnations = { f: `incarnation:f:${++generation}` };
  generations = { f: ++generation }; revision++;
  requests.splice(0); emit();
  context.mock.timers.enable({ apis: ["setTimeout"] });
}

test("an accepted completion timer cleans up under the acknowledged native generation and keeps the completed entry", async (context) => {
  await reset(context);
  await refreshFolder("f"); await flushLinuxDocuments();
  const acceptedGeneration = generations.f;
  assert.deepEqual(live().completing.f, ["i"]);
  context.mock.timers.tick(COMPLETION_MS); await flushLinuxDocuments();
  assert.deepEqual(payload.items.f, []);
  assert.equal(payload.completed.f[0].item.id, "i");
  const cleanup = requests.at(-1).operations[0];
  assert.deepEqual([cleanup.type, cleanup.generation, cleanup.owner, cleanup.incarnation], ["refresh", acceptedGeneration, "a", incarnations.f]);
});

for (const behavior of ["superseded", "reject", "lose"]) test(`the completion timer cannot delete the canonical item after a ${behavior} refresh`, async (context) => {
  await reset(context);
  mode = behavior;
  await refreshFolder("f");
  if (behavior === "superseded") await flushLinuxDocuments();
  else await assert.rejects(flushLinuxDocuments());
  assert.deepEqual(live().completing.f, []);
  context.mock.timers.tick(COMPLETION_MS);
  mode = "accept"; await flushLinuxDocuments();
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  assert.equal(requests.some((request) => request.operations[0].type === "entry"), false);
});

test("the canonical event that arrives before a held reply cannot authorize its completion timer", async (context) => {
  await reset(context);
  const gate = deferred(); heldReply = gate;
  await refreshFolder("f"); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(live().completing.f, ["i"]);
  context.mock.timers.tick(COMPLETION_MS);
  assert.deepEqual(live().completing.f, []);
  gate.resolve(); await flushLinuxDocuments();
  assert.deepEqual(payload.items.f.map((entry) => entry.id), ["i"]);
  assert.equal(requests.filter((request) => request.operations[0].type === "refresh").length, 1);
});
