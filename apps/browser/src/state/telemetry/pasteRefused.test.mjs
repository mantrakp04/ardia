import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "26.1.0", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 99, sharing: true, installId: "paste", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: null, sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
client.loadChoice();
const { flushLocal } = await import("./localStore.ts");
const { watchPasteRefused } = await import("./pasteRefused.ts");
watchPasteRefused();

const queued = () => {
  client.saveQueueNow();
  return JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[],"logs":[]}').events.filter((e) => e.event === "paste_refused");
};
const local = () => {
  flushLocal();
  return stub.telemetryLocal.records().filter((r) => r.event === "paste_refused");
};

test("a paste that finds no text records its reason, the pasteboard's type names, the OS, the layout and the gate flag", () => {
  stub.emitAppEvent({ type: "pasteRefused", reason: "no_text", gateOpen: true, layout: "com.apple.keylayout.US", types: ["public.rtf", "NeXT TIFF v4.0 pasteboard type", "public.png"] });
  const [event] = queued();
  assert.equal(queued().length, 1);
  assert.equal(event.properties.reason, "no_text");
  assert.equal(event.properties.type_ids, "public.rtf,NeXT TIFF v4.0 pasteboard type,public.png");
  assert.equal(event.properties.$os_version, "26.1.0");
  assert.equal(event.properties.keyboard_layout, "com.apple.keylayout.US");
  assert.equal(event.properties.gate_open, true);
  assert.equal(local().length, 1);
  assert.equal(local()[0].properties.type_ids, event.properties.type_ids);
});

test("a keystroke the focus gate dropped records the reason and what was dropped, without type names", () => {
  stub.emitAppEvent({ type: "pasteRefused", reason: "deadline", gateOpen: false, layout: "com.apple.keylayout.German", dropped: 2 });
  const event = queued().at(-1);
  assert.equal(event.properties.reason, "deadline");
  assert.equal(event.properties.gate_open, false);
  assert.equal(event.properties.dropped, 2);
  assert.equal("edit" in event.properties, false);
  assert.equal(event.properties.keyboard_layout, "com.apple.keylayout.German");
  assert.equal("type_ids" in event.properties, false);
});

test("a refused menu Paste records the first responder's class", () => {
  stub.emitAppEvent({ type: "pasteRefused", reason: "refused", gateOpen: true, responder: "NSTextView" });
  const event = queued().at(-1);
  assert.equal(event.properties.reason, "refused");
  assert.equal(event.properties.responder, "NSTextView");
});

test("a deferred menu Paste records its reason, and a later one without a responder is still recorded", () => {
  stub.emitAppEvent({ type: "pasteRefused", reason: "deferred", gateOpen: false, responder: "RCTUIPlainPasteFieldEditor" });
  const first = queued().at(-1);
  assert.equal(first.properties.reason, "deferred");
  assert.equal(first.properties.gate_open, false);
  assert.equal(first.properties.responder, "RCTUIPlainPasteFieldEditor");
  const before = queued().length;
  stub.emitAppEvent({ type: "pasteRefused", reason: "deferred", gateOpen: false });
  assert.equal(queued().length, before + 1);
  assert.equal("responder" in queued().at(-1).properties, false);
});

test("only names are kept: anything that is not a recognised type identifier becomes other, dynamic types are collapsed", () => {
  stub.emitAppEvent({
    type: "pasteRefused",
    reason: "no_text",
    gateOpen: true,
    layout: "/Users/someone/layout",
    responder: "NSTextView in /Users/someone",
    types: ["public.html", "https://example.com/a?token=secret", `dyn.${"a".repeat(40)}`, "dyn.abc", "public.data /Users/alice/private", "/Users/alice/private", "hello, world", 7, null, "public.html", "text/html", "Apple PNG pasteboard type", "CorePasteboardFlavorType 0x54455854"],
  });
  const event = queued().at(-1);
  assert.equal(event.properties.type_ids, "public.html,other,dyn,text/html,Apple PNG pasteboard type,CorePasteboardFlavorType 0x54455854");
  assert.equal("keyboard_layout" in event.properties, false);
  assert.equal("responder" in event.properties, false);
  assert.doesNotMatch(JSON.stringify(event), /example\.com|secret|Users|alice/);
});

test("an unknown reason is recorded as unknown and the type list is capped", () => {
  stub.emitAppEvent({ type: "pasteRefused", reason: "something else", gateOpen: false, types: Array.from({ length: 60 }, (_, i) => `public.type${i}`) });
  const event = queued().at(-1);
  assert.equal(event.properties.reason, "unknown");
  assert.equal(event.properties.type_ids.split(",").length, 24);
});

test("other app events record nothing", () => {
  const before = queued().length;
  stub.emitAppEvent({ type: "dragEscape" });
  assert.equal(queued().length, before);
});

test("nothing is sent while sharing is off", () => {
  client.setSharing(false, "settings");
  const recorded = local().length;
  stub.emitAppEvent({ type: "pasteRefused", reason: "no_text", gateOpen: true, types: ["public.rtf"] });
  assert.equal(queued().length, 0);
  assert.equal(local().length, recorded + 1);
  assert.equal(local().at(-1).sent, false);
});
