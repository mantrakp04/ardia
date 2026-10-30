import assert from "node:assert/strict";
import test from "node:test";
import { createLiveDocumentClient } from "./liveDocumentClient.ts";
import { projectLiveIntent } from "./liveDocumentIntent.ts";
import { createHostDocuments } from "./hostDocuments.ts";

const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const initial = () => ({ folders: {}, folderOrder: [], items: {}, hidden: {}, known: {}, unread: {}, completed: {}, accounts: {}, expandedStacks: {}, config: {}, calendar: { showPreview: true, showTimeToNext: true, hiddenCalendarIds: [] }, dismissedAlerts: [], meetingGroups: {}, version: 1 });

function authority() {
  let payload = initial(), revision = 0;
  const clients = [];
  const commits = [];
  const control = { fail: false, lose: false, muted: false, replyGate: undefined };
  const snapshot = (client) => ({ document: "live.json", scope: "scope", epoch: "epoch", revision, clientId: client.id, watermark: client.sequence, payload: structuredClone(payload), incarnations: Object.fromEntries(Object.keys(payload.folders).map((id) => [id, `folder:${id}`])), generations: {} });
  const emit = (source, requestId) => {
    if (control.muted) return;
    for (const client of clients) for (const listener of client.listeners) listener("ArdiaDocuments", "documents", { name: "documents.changed", data: { snapshot: snapshot(client), clientId: source, requestId } });
  };
  const connect = (id) => {
    const client = { id, listeners: new Set(), receipts: new Set(), sequence: 0 };
    clients.push(client);
    return {
      bootstrap: { windowId: id, profileId: "default" },
      onEvent(listener) { client.listeners.add(listener); return () => client.listeners.delete(listener); },
      async call(name, profile, json) {
        const args = JSON.parse(json);
        if (name !== "documents.commit") return name === "documents.unwatch" ? "{}" : JSON.stringify(snapshot(client));
        commits.push(structuredClone(args));
        if (control.fail) throw new Error("Storage failure");
        if (!client.receipts.has(args.requestId)) {
          for (const op of args.operations) {
            if (op.type === "field" && ["calendar", "config"].includes(op.target) && JSON.stringify(payload[op.target][op.field] ?? null) !== JSON.stringify(op.expected)) {
              return JSON.stringify({ status: "conflict", snapshot: snapshot(client), requestId: args.requestId });
            }
          }
          payload = projectLiveIntent(payload, args.operations);
          revision++;
          client.sequence++;
          client.receipts.add(args.requestId);
          emit(id, args.requestId);
        }
        if (control.lose) { control.lose = false; throw new Error("Lost reply"); }
        const response = JSON.stringify({ status: "committed", snapshot: snapshot(client), requestId: args.requestId });
        const gate = control.replyGate; control.replyGate = undefined;
        if (gate) await gate.promise;
        return response;
      },
    };
  };
  return Object.defineProperties(Object.assign(control, { connect, commits }), { payload: { get: () => payload } });
}

function bind(host) {
  const client = createLiveDocumentClient(host);
  let state = initial();
  client.start((payload) => { state = payload; });
  return { client, state: () => state, edit: (patch) => { const before = state; state = { ...state, ...patch }; client.changed(before, state); } };
}

test("renderers converge on disjoint edits, and a stale same-field edit loses to the newer canonical value", async () => {
  const native = authority();
  const a = bind(native.connect("browser-a")), b = bind(native.connect("browser-b")), settings = bind(native.connect("settings"));
  await Promise.all([a.client.reconnect(), b.client.reconnect(), settings.client.reconnect()]);
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  settings.edit({ calendar: { ...settings.state().calendar, showTimeToNext: false } });
  await Promise.all([a.client.flush(), settings.client.flush()]);
  assert.equal(native.payload.calendar.showPreview, false);
  assert.equal(native.payload.calendar.showTimeToNext, false);
  for (const renderer of [a, b, settings]) assert.deepEqual(renderer.state(), native.payload);
  const stale = a.state();
  settings.edit({ calendar: { ...settings.state().calendar, showPreview: true } });
  await settings.client.flush();
  a.client.changed(stale, { ...stale, calendar: { ...stale.calendar, showPreview: false } });
  await a.client.flush();
  assert.equal(native.payload.calendar.showPreview, true);
});

test("a failed commit keeps the pending intent and canonical cache, and the retry reuses its request identity", async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  native.fail = true;
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await assert.rejects(a.client.flush(), /Storage failure/);
  assert.equal(a.client.state().dirty, true);
  assert.equal(a.client.state().canonical.payload.calendar.showPreview, true);
  native.fail = false;
  await a.client.flush();
  assert.equal(a.client.state().dirty, false);
  assert.equal(native.commits[0].requestId, native.commits.at(-1).requestId);
});

test("a lost reply after the source saw its canonical event settles without a duplicate commit", async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  native.lose = true;
  a.edit({ calendar: { ...a.state().calendar, hiddenCalendarIds: ["calendar"] } });
  await assert.rejects(a.client.flush(), /Lost reply/);
  assert.equal(a.client.state().dirty, false);
  await a.client.flush();
  assert.deepEqual(native.payload.calendar.hiddenCalendarIds, ["calendar"]);
  assert.equal(native.commits.length, 1);
});

test("an older commit reply cannot overwrite a later peer canonical event", async () => {
  const native = authority(), a = bind(native.connect("a")), b = bind(native.connect("b"));
  await Promise.all([a.client.reconnect(), b.client.reconnect()]);
  const gate = deferred(); native.replyGate = gate;
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await turn();
  b.edit({ calendar: { ...b.state().calendar, showTimeToNext: false } });
  await b.client.flush();
  gate.resolve();
  await a.client.flush();
  assert.equal(a.client.state().canonical.revision, 2);
  assert.deepEqual(a.state(), native.payload);
});

test("a forged resnapshot never drops a pending create, and an authentic one settles it", async () => {
  const native = authority(), host = native.connect("a"), a = bind(host);
  await a.client.reconnect();
  native.muted = true; native.lose = true;
  a.edit({ folders: { f: { id: "f" } }, folderOrder: ["f"] });
  await assert.rejects(a.client.flush());
  const call = host.call;
  host.call = async (...args) => JSON.stringify({ ...JSON.parse(await call(...args)), clientId: "forged" });
  await assert.rejects(a.client.reconnect());
  assert.equal(a.client.state().dirty, true);
  host.call = call;
  await a.client.reconnect();
  assert.equal(a.client.state().dirty, false);
  assert.deepEqual(a.state().folderOrder, ["f"]);
});

test("generic document writes keep the old cache on failure and reserved documents are refused", async () => {
  let fail = true;
  const documents = createHostDocuments({ bootstrap: { documents: { "opaque.nns": "old", "live.canonical.json": "internal" } }, async invoke() { if (fail) throw new Error("Storage failure"); } });
  await assert.rejects(documents.write("opaque.nns", "new"), /Storage/);
  assert.equal(documents.read("opaque.nns"), "old");
  fail = false;
  await documents.write("opaque.nns", "new");
  assert.equal(documents.read("opaque.nns"), "new");
  await assert.rejects(documents.write("live.json", "{}"), { code: "ERR_DOCUMENT_RESERVED" });
  assert.equal(documents.read("live.canonical.json"), null);
});
