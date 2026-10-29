import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";

const fixture = (call) => ({ bootstrap: { windowId: "settings", profileId: "default" }, call, invoke: () => assert.fail("Document calls must use the document domain"), onEvent: () => () => {} });

test("ArdiaDocuments sends only canonical verbs and returns JSON text once", async () => {
  const sent = [];
  const json = '{"status":"conflict","reason":"notOwner","snapshot":{"document":"live.json","revision":7}}';
  const host = fixture(async (...args) => { sent.push(args); return json; });
  const call = resolveHostModule(host, "ArdiaDocuments", "call");
  for (const verb of ["watch", "commit", "flush", "unwatch"]) {
    const args = JSON.stringify({ document: "live.json" });
    assert.equal(await call(verb, "default", args), json);
    assert.deepEqual(sent.at(-1), [`documents.${verb}`, "default", args]);
  }
  await assert.rejects(call("read", "default", "{}"), { code: "ERR_UNKNOWN_CALL" });
  await assert.rejects(call("seal", "default", "{}"), { code: "ERR_UNKNOWN_CALL" });
  await assert.rejects(call("watch", "default", null), { code: "ERR_DOCUMENT_REQUEST" });
  assert.equal(sent.length, 4);
});

test("canonical storage and authorization errors retain native code and message", async () => {
  for (const code of ["ERR_DOCUMENT_STORAGE", "ERR_DOCUMENT_AUTH", "ERR_DOCUMENT_CLOSING", "ERR_DOCUMENT_WATERMARK"]) {
    const error = Object.assign(new Error("Native document refusal"), { code });
    const host = fixture(async () => { throw error; });
    const call = resolveHostModule(host, "ArdiaDocuments", "call");
    await assert.rejects(call("commit", "unknown-profile", "{}"), (actual) => actual === error && actual.code === code && actual.message === "Native document refusal");
  }
});
