import assert from "node:assert/strict";
import test from "node:test";
import { createLiveDocumentClient } from "./liveDocumentClient.ts";
import { captureLiveIntent, projectLiveIntent } from "./liveDocumentIntent.ts";
import { createHostDocuments } from "./hostDocuments.ts";
import { createWindowCloseBarrier } from "./utilityClose.ts";

const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const initial = () => ({ folders: {}, folderOrder: [], items: {}, hidden: {}, known: {}, unread: {}, completed: {}, accounts: {}, expandedStacks: {}, config: {}, calendar: { showPreview: true, showTimeToNext: true, hiddenCalendarIds: [] }, dismissedAlerts: [], meetingGroups: {}, version: 1 });

function authority() {
  let payload = initial(), revision = 0, epoch = "epoch";
  const clients = [];
  const commits = [];
  let fail = false, lose = false, hold, replyGate, muted = false;
  const snapshot = (client) => ({ document: "live.json", scope: "scope", epoch, revision, clientId: client.id, watermark: client.sequence, payload: structuredClone(payload), incarnations: Object.fromEntries(Object.keys(payload.folders).map((id) => [id, `folder:${id}`])), generations: {} });
  const emit = (source, requestId) => {
    if (muted) return;
    for (const client of clients) for (const listener of client.listeners) listener("ArdiaDocuments", "documents", { name: "documents.changed", data: { snapshot: snapshot(client), clientId: source, requestId } });
  };
  const connect = (id) => {
    const client = { id, listeners: new Set(), receipts: new Map(), sequence: 0 };
    clients.push(client);
    return {
      bootstrap: { windowId: id, profileId: "default" },
      onEvent(listener) { client.listeners.add(listener); return () => client.listeners.delete(listener); },
      async call(name, profile, json) {
        assert.equal(profile, "default");
        const args = JSON.parse(json);
        assert.equal(args.document, "live.json");
        if (name === "documents.watch") { assert.ok(client.listeners.size); const reply = snapshot(client); if (hold) await hold.promise; return JSON.stringify(reply); }
        if (name === "documents.unwatch") return "{}";
        if (name === "documents.flush") { assert.ok(args.watermark <= client.sequence); return JSON.stringify(snapshot(client)); }
        assert.equal(name, "documents.commit");
        commits.push(structuredClone(args));
        if (fail) throw new Error("Storage failure");
        if (hold) await hold.promise;
        if (!client.receipts.has(args.requestId)) {
          for (const op of args.operations) {
            if (op.type === "field" && ["calendar", "config"].includes(op.target)) {
              if (JSON.stringify(payload[op.target][op.field] ?? null) !== JSON.stringify(op.expected)) return JSON.stringify({ status: "conflict", snapshot: snapshot(client), requestId: args.requestId });
            }
          }
          payload = projectLiveIntent(payload, args.operations);
          revision++;
          client.sequence++;
          client.receipts.set(args.requestId, true);
          emit(id, args.requestId);
        }
        if (lose) { lose = false; throw new Error("Lost reply"); }
        const response = JSON.stringify({ status: "committed", snapshot: snapshot(client), requestId: args.requestId });
        const gate = replyGate; replyGate = undefined;
        if (gate) await gate.promise;
        return response;
      },
    };
  };
  return { connect, commits, snapshot, emit, get payload() { return payload; }, set fail(value) { fail = value; }, set lose(value) { lose = value; }, set hold(value) { hold = value; }, set epoch(value) { epoch = value; }, set muted(value) { muted = value; }, set replyGate(value) { replyGate = value; } };
}

function bind(host) {
  const client = createLiveDocumentClient(host);
  let state = initial();
  client.start((payload) => { state = payload; });
  return { client, state: () => state, edit: (patch) => { const before = state; state = { ...state, ...patch }; client.changed(before, state); } };
}

test("two browser renderers plus Settings converge on disjoint edits and same-field original intent", async () => {
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

test("failure retains pending intent and canonical cache; retry uses same request identity", async () => {
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

test("source processes its canonical event before a lost reply without duplicate effects", async () => {
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

test("listener precedes loading; buffered events beat the stale watch reply", async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  const gate = deferred();
  native.hold = gate;
  const b = bind(native.connect("b"));
  native.hold = undefined;
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await a.client.flush();
  gate.resolve();
  await turn();
  assert.equal(b.state().calendar.showPreview, false);
  assert.equal(b.client.state().canonical.revision, 1);
});

test("entry identity uses completed item.id; deletion intent does not serialize dependent snapshots", () => {
  const before = { ...initial(), folders: { f: { id: "f", name: "a" } }, folderOrder: ["f"], completed: { f: [{ item: { id: "actual" }, state: "closed", at: 1 }] } };
  const snapshot = { incarnations: { f: "incarnation" } };
  const changed = captureLiveIntent(before, { ...before, completed: { f: [] } }, snapshot);
  assert.equal(changed[0].key, "actual");
  const deleted = captureLiveIntent(before, { ...before, folders: {}, folderOrder: [], completed: {} }, snapshot);
  assert.deepEqual(deleted, [{ type: "delete", id: "f", incarnation: "incarnation" }]);
  assert.deepEqual(projectLiveIntent(before, deleted).completed, {});
});

test("dismissed Now badges and the countdown lead travel as narrow intents and round-trip", () => {
  const occurrence = `calendar-${"x".repeat(200)}/uid@1700000000`;
  const before = { ...initial(), calendar: { ...initial().calendar, countdownLead: 60 }, dismissedNow: { expired: 1 } };
  const after = { ...before, calendar: { ...before.calendar, countdownLead: 15 }, dismissedNow: { [occurrence]: 1700000600000 } };
  const operations = captureLiveIntent(before, after, { incarnations: {} });
  assert.deepEqual(operations, [
    { type: "field", target: "calendar", field: "countdownLead", expected: 60, value: 15 },
    { type: "field", target: "dismissedNow", id: "expired", field: "value", expected: 1, value: null },
    { type: "field", target: "dismissedNow", id: occurrence, field: "value", expected: null, value: 1700000600000 },
  ]);
  const projected = projectLiveIntent(before, operations);
  assert.deepEqual(projected.dismissedNow, after.dismissedNow);
  assert.equal(projected.calendar.countdownLead, 15);
  const legacy = { ...initial() };
  assert.deepEqual(projectLiveIntent(legacy, captureLiveIntent({ ...legacy, dismissedNow: {} }, { ...legacy, dismissedNow: { a: 2 } }, { incarnations: {} })).dismissedNow, { a: 2 });
});

test("renderers dismissing different Now badges converge on the canonical record", async () => {
  const native = authority(), a = bind(native.connect("a")), b = bind(native.connect("b"));
  await Promise.all([a.client.reconnect(), b.client.reconnect()]);
  a.edit({ dismissedNow: { "cal/uid@1": 5000 } });
  b.edit({ dismissedNow: { "cal/uid@2": 6000 } });
  await Promise.all([a.client.flush(), b.client.flush()]);
  assert.deepEqual(native.payload.dismissedNow, { "cal/uid@1": 5000, "cal/uid@2": 6000 });
  for (const renderer of [a, b]) assert.deepEqual(renderer.state().dismissedNow, native.payload.dismissedNow);
});

test("generic document failures do not update read cache and reserved files reject", async () => {
  let fail = true;
  const documents = createHostDocuments({ bootstrap: { documents: { "opaque.nns": "old", "live.canonical.json": "internal" } }, async invoke() { if (fail) throw new Error("Storage failure"); } });
  await assert.rejects(documents.write("opaque.nns", "new"), /Storage/);
  assert.equal(documents.read("opaque.nns"), "old");
  fail = false;
  await documents.write("opaque.nns", "new");
  assert.equal(documents.read("opaque.nns"), "new");
  fail = true;
  await assert.rejects(documents.remove("opaque.nns"), /Storage/);
  assert.equal(documents.read("opaque.nns"), "new");
  await assert.rejects(documents.write("live.json", "{}"), { code: "ERR_DOCUMENT_RESERVED" });
  await assert.rejects(documents.remove("live.canonical.json"), { code: "ERR_DOCUMENT_RESERVED" });
  assert.equal(documents.read("live.canonical.json"), null);
});

test("close barrier shares repeated close, awaits final persistence and retries after cancellation", async () => {
  const gate = deferred(), steps = [];
  let fail = true;
  const close = createWindowCloseBarrier({
    quiesce() { steps.push("quiesce"); },
    async drain() { steps.push("drain"); await gate.promise; if (fail) throw new Error("Save failed"); return 7; },
    async acknowledge(request, watermark) { assert.equal(watermark, 7); steps.push("ack"); },
    async reject() { steps.push("reject"); },
    resume() { steps.push("resume"); },
  });
  const request = { windowId: "browser", rendererGeneration: "9007199254740993", closeGeneration: "1" };
  const first = close(request);
  assert.equal(close(request), first);
  await turn();
  assert.deepEqual(steps, ["quiesce", "drain"]);
  gate.resolve();
  await assert.rejects(first, /Save failed/);
  assert.deepEqual(steps, ["quiesce", "drain", "reject", "resume"]);
  fail = false;
  await close({ ...request, closeGeneration: "2" });
  assert.equal(steps.at(-1), "ack");
});

test("same-field conflict retries the narrow original intent against canonical fields", async () => {
  const native = authority(), a = bind(native.connect("a")), b = bind(native.connect("b"));
  await Promise.all([a.client.reconnect(), b.client.reconnect()]);
  const stale = a.state();
  b.edit({ config: { label: "peer" }, calendar: { ...b.state().calendar, showTimeToNext: false } });
  await b.client.flush();
  a.client.changed(stale, { ...stale, config: { label: "local" } });
  await a.client.flush();
  assert.equal(native.payload.config.label, "local");
  assert.equal(native.payload.calendar.showTimeToNext, false);
  assert.equal(native.commits.at(-1).operations[0].expected, "peer");
  assert.equal(native.commits.at(-1).operations[0].value, "local");
});

test("reconnect resnapshots a new epoch and preserves accepted request sequencing", async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await a.client.flush();
  native.epoch = "restarted";
  await a.client.reconnect();
  a.edit({ calendar: { ...a.state().calendar, showTimeToNext: false } });
  await a.client.flush();
  assert.equal(native.commits.at(-1).epoch, "restarted");
  assert.equal(native.commits.at(-1).requestId, "a:2");
});

test("close cancellation failure keeps producers quiesced; another close token stays active", async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  a.client.quiesce("one"); a.client.quiesce("two"); a.client.resume("one");
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  assert.equal(a.state().calendar.showPreview, true);
  assert.equal(a.client.state().closing, true);
  a.client.resume("two");
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await a.client.flush();
  assert.equal(native.payload.calendar.showPreview, false);
  let resumed = false;
  const close = createWindowCloseBarrier({ quiesce() {}, async drain() { throw new Error("write failed"); }, async acknowledge() {}, async reject() { throw new Error("cancellation not established"); }, resume() { resumed = true; } });
  await assert.rejects(close({ windowId: "w", rendererGeneration: "1", closeGeneration: "1" }), /cancellation not established/);
  assert.equal(resumed, false);
});

test("unsupported private authority fails closed and malformed watermark never becomes saved", async () => {
  const native = authority();
  const host = native.connect("a");
  const original = host.call;
  host.call = async (...args) => {
    const result = JSON.parse(await original(...args));
    result.watermark = -1;
    return JSON.stringify(result);
  };
  const client = createLiveDocumentClient(host);
  await assert.rejects(client.flush(), { code: "ERR_BAD_REPLY" });
  let calls = 0;
  const privateClient = createLiveDocumentClient({ bootstrap: { profileId: "incognito:private" }, onEvent() { return () => {}; }, async call() { calls++; throw Object.assign(new Error("Unsupported private authority"), { code: "ERR_DOCUMENT_AUTH" }); } });
  await assert.rejects(privateClient.flush(), { code: "ERR_DOCUMENT_AUTH" });
  assert.equal(calls, 1);
});

test("lost reply plus absent source event survives a new authority epoch without dropping unaccepted intent", async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  native.muted = true; native.lose = true;
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await assert.rejects(a.client.flush(), /Lost reply/);
  assert.equal(a.client.state().dirty, true);
  const stale = a.state();
  a.client.changed(stale, { ...stale, calendar: { ...stale.calendar, showTimeToNext: false } });
  native.epoch = "restarted";
  await a.client.reconnect();
  await a.client.flush();
  assert.equal(a.client.state().dirty, false);
  assert.equal(native.payload.calendar.showPreview, false);
  assert.equal(native.payload.calendar.showTimeToNext, false);
  assert.deepEqual(native.commits.map((request) => request.requestId), ["a:1", "a:2"]);
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

test("destroying the source subscription does not cancel accepted persistence or peer convergence", async () => {
  const native = authority(), a = bind(native.connect("a")), b = bind(native.connect("b"));
  await Promise.all([a.client.reconnect(), b.client.reconnect()]);
  const gate = deferred(); native.hold = gate;
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await turn();
  await a.client.dispose();
  native.hold = undefined; gate.resolve();
  await a.client.flush();
  assert.equal(native.payload.calendar.showPreview, false);
  assert.equal(b.state().calendar.showPreview, false);
});

for (const changedEpoch of [false, true]) test(`authenticated resnapshot removes accepted create before projection and preserves later intent, changed epoch ${changedEpoch}`, async () => {
  const native = authority(), a = bind(native.connect("a"));
  await a.client.reconnect();
  native.muted = true; native.lose = true;
  a.edit({ folders: { f: { id: "f" } }, folderOrder: ["f"] });
  await assert.rejects(a.client.flush(), /Lost reply/);
  assert.equal(a.client.state().dirty, true);
  if (changedEpoch) native.epoch = "replacement";
  await a.client.reconnect();
  assert.equal(a.client.state().dirty, false);
  assert.deepEqual(a.state().folderOrder, ["f"]);
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await a.client.flush();
  assert.deepEqual(a.state().folderOrder, ["f"]);
  assert.equal(native.commits.at(-1).requestId, "a:2");
});

for (const corrupt of [
  (snapshot) => ({ ...snapshot, clientId: "forged" }),
  (snapshot) => ({ ...snapshot, scope: "forged" }),
  (snapshot) => ({ ...snapshot, watermark: 2 }),
  (snapshot) => ({ ...snapshot, watermark: -1 }),
  (snapshot) => ({ ...snapshot, watermark: 0.5 }),
]) test("unauthenticated or impossible resnapshot never drops pending create", async () => {
  const native = authority(), host = native.connect("a"), a = bind(host);
  await a.client.reconnect();
  native.muted = true; native.lose = true;
  a.edit({ folders: { f: { id: "f" } }, folderOrder: ["f"] });
  await assert.rejects(a.client.flush());
  const call = host.call;
  host.call = async (...args) => JSON.stringify(corrupt(JSON.parse(await call(...args))));
  await assert.rejects(a.client.reconnect());
  assert.equal(a.client.state().dirty, true);
  host.call = call;
  await a.client.reconnect();
  assert.equal(a.client.state().dirty, false);
  assert.deepEqual(a.state().folderOrder, ["f"]);
});

function refusingOwner(changeReply = (reply) => reply) {
  let payload = { ...initial(), folders: { f: { id: "f" } }, folderOrder: ["f"] }, watermark = 0, revision = 0;
  const requests = [];
  const snapshot = () => ({ document: "live.json", clientId: "b", scope: "scope", epoch: "epoch", revision, watermark, payload, incarnations: { f: "folder:f" }, generations: { f: 2 } });
  const host = {
    bootstrap: { profileId: "default" }, onEvent() { return () => {}; },
    async call(name, profile, json) {
      const request = JSON.parse(json);
      if (name === "documents.watch" || name === "documents.flush") return JSON.stringify(snapshot());
      requests.push(request);
      if (request.operations[0].type === "claim") return JSON.stringify(changeReply({ status: "conflict", reason: "notOwner", requestId: request.requestId, snapshot: snapshot() }));
      assert.equal(request.requestId, `b:${watermark + 1}`);
      payload = projectLiveIntent(payload, request.operations); watermark++; revision++;
      return JSON.stringify({ status: "committed", requestId: request.requestId, snapshot: snapshot() });
    },
  };
  return { host, requests, snapshot };
}

test("definitive owner refusal retires one producer without consuming sequence or blocking user edits and close", async () => {
  const native = refusingOwner(), a = bind(native.host);
  await a.client.reconnect();
  const started = deferred(), gate = deferred(), call = native.host.call;
  native.host.call = async (name, profile, json) => {
    if (name === "documents.commit" && JSON.parse(json).operations[0].type === "claim") { started.resolve(); await gate.promise; }
    return call(name, profile, json);
  };
  const claim = a.client.beginRefresh("f");
  await started.promise;
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  gate.resolve();
  assert.equal(await claim, null);
  a.client.quiesce("close");
  assert.equal(await a.client.flush(), 1);
  assert.equal(a.client.state().dirty, false);
  assert.equal(native.requests.filter((request) => request.operations[0].type === "claim").length, 1);
  assert.deepEqual(native.requests.map((request) => request.requestId), ["b:1", "b:1"]);
  assert.equal(native.snapshot().payload.calendar.showPreview, false);
});

for (const changeReply of [
  (reply) => ({ ...reply, reason: "unknown" }),
  (reply) => ({ ...reply, requestId: "b:0" }),
  (reply) => ({ ...reply, snapshot: { ...reply.snapshot, clientId: "forged" } }),
  (reply) => ({ ...reply, snapshot: { ...reply.snapshot, epoch: "stale" } }),
  (reply) => ({ ...reply, snapshot: { ...reply.snapshot, watermark: 1 } }),
]) test("unproven ownership refusal retains producer and following user intent", async () => {
  const native = refusingOwner(changeReply), a = bind(native.host);
  await a.client.reconnect();
  await assert.rejects(a.client.beginRefresh("f"));
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await assert.rejects(a.client.flush());
  assert.equal(a.client.state().dirty, true);
  assert.equal(native.requests.some((request) => request.operations[0].type === "field"), false);
});

test("a lost accepted claim reply retries its accepted identity and preserves following user sequence", async () => {
  const native = refusingOwner();
  const call = native.host.call;
  let lose = true, accepted = false;
  native.host.call = async (name, profile, json) => {
    const request = JSON.parse(json);
    if (name === "documents.commit" && request.operations[0].type === "claim") {
      native.requests.push(request);
      accepted = true;
      if (lose) { lose = false; throw new Error("Lost accepted claim reply"); }
      return JSON.stringify({ status: "committed", requestId: request.requestId, snapshot: { ...native.snapshot(), watermark: 1 } });
    }
    if (accepted && name === "documents.commit") {
      assert.equal(request.requestId, "b:2");
      native.requests.push(request);
      return JSON.stringify({ status: "committed", requestId: request.requestId, snapshot: { ...native.snapshot(), watermark: 2, payload: projectLiveIntent(native.snapshot().payload, request.operations) } });
    }
    return call(name, profile, json);
  };
  const a = bind(native.host);
  await a.client.reconnect();
  await assert.rejects(a.client.beginRefresh("f"), /Lost accepted claim/);
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await a.client.flush();
  assert.deepEqual(native.requests.map((request) => request.requestId), ["b:1", "b:1", "b:2"]);
  assert.equal(a.client.state().dirty, false);
});

test("storage failure never becomes skipped ownership and retry preserves later Calendar intent", async () => {
  const native = refusingOwner(), call = native.host.call;
  const attempts = [];
  let fail = true;
  native.host.call = async (name, profile, json) => {
    if (name === "documents.commit") {
      const request = JSON.parse(json); attempts.push(request.requestId);
      if (fail) throw Object.assign(new Error("Storage unavailable"), { code: "ERR_DOCUMENT_STORAGE" });
    }
    return call(name, profile, json);
  };
  const a = bind(native.host); await a.client.reconnect();
  await assert.rejects(a.client.beginRefresh("f"), { code: "ERR_DOCUMENT_STORAGE" });
  assert.equal(a.client.state().dirty, true);
  a.edit({ calendar: { ...a.state().calendar, showPreview: false } });
  await assert.rejects(a.client.flush(), { code: "ERR_DOCUMENT_STORAGE" });
  fail = false; await a.client.flush();
  assert.equal(a.client.state().dirty, false);
  assert.equal(native.snapshot().payload.calendar.showPreview, false);
  assert.ok(attempts.every((id) => id === "b:1"));
});

test("ownership refusal older than the observed operation base cannot retire the producer", async () => {
  const native = refusingOwner(); let listener;
  native.host.onEvent = (callback) => { listener = callback; return () => {}; };
  const a = bind(native.host); await a.client.reconnect();
  listener("ArdiaDocuments", "documents", { name: "documents.changed", data: { clientId: "peer", requestId: "peer:1", snapshot: { ...native.snapshot(), revision: 5 } } });
  await assert.rejects(a.client.beginRefresh("f"), { code: "ERR_BAD_REPLY" });
  assert.equal(a.client.state().dirty, true);
  assert.equal(native.requests[0].observedRevision, 5);
});
