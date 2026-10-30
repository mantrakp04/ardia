import assert from "node:assert/strict";
import test from "node:test";
import { createHostDialogs } from "./hostDialogs.ts";

const turn = () => new Promise((resolve) => setImmediate(resolve));
function fixture(windowId = "a", generation = "9007199254740993") {
  const listeners = new Set();
  const closing = new Set();
  const requests = [];
  let sequence = 0;
  const host = {
    bootstrap: { windowId, profileId: "default" },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onBeforeClose(listener) { closing.add(listener); return () => closing.delete(listener); },
    async invoke(method, data) {
      requests.push({ method, ...data });
      return method === "ArdiaShell.windowIdentity" ? { windowId, rendererGeneration: generation } : { accepted: true };
    },
  };
  const dialogs = createHostDialogs(host, () => `dialog:test-identity-${++sequence}`);
  const emit = (result, overrides = {}) => {
    const request = requests.findLast((r) => r.method.endsWith("beginDialog"));
    const data = { dialogId: request?.args[0].dialogId, windowId, rendererGeneration: generation, result, ...overrides };
    for (const listener of listeners) listener("ArdiaShell", "shell", { name: "shell.dialogResolved", data });
  };
  return { host, dialogs, requests, listeners, closing, emit };
}
const requestsFor = (f, method) => f.requests.filter((request) => request.method === `ArdiaShell.${method}`);

test("confirm preserves presentation, destructive label and checkbox on Cancel", async () => {
  const f = fixture();
  const options = { title: "Delete Profile?", message: "Cannot undo", confirmTitle: "Delete Profile", cancelTitle: "Keep Profile", destructive: true, suppression: "Don’t ask me again", windowId: "a" };
  const work = f.dialogs.confirm(options);
  await turn();
  assert.deepEqual(f.requests[1].args[0], { dialogId: "dialog:test-identity-1:1", kind: "confirm", options });
  f.emit({ confirmed: false, suppressed: true });
  assert.deepEqual(await work, { confirmed: false, suppressed: true });
  f.dialogs.retire();
});

test("prompt trims nonempty text and returns null for empty input or cancel", async () => {
  const f = fixture();
  for (const [reply, expected] of [["  Renamed\n", "Renamed"], ["  \n", null], [null, null]]) {
    const work = f.dialogs.prompt({ title: "Rename", value: "Old", placeholder: "Name", confirmTitle: "Update" });
    await turn(); f.emit(reply);
    assert.equal(await work, expected);
  }
  f.dialogs.retire();
});

test("result before ack buffers once; failed acknowledgement never accepts it", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    let ack;
    f.host.invoke = (method, data) => {
      f.requests.push({ method, ...data });
      if (method.endsWith("windowIdentity")) return Promise.resolve({ windowId: "a", rendererGeneration: "9007199254740993" });
      if (method.endsWith("cancelDialog")) return Promise.resolve();
      f.emit({ confirmed: true, suppressed: true });
      f.emit({ confirmed: false, suppressed: false });
      return new Promise((resolve, reject) => { ack = fail ? () => reject(new Error("begin failed")) : () => resolve({ accepted: true }); });
    };
    let settled = false;
    const work = f.dialogs.confirm({ title: "Confirm", suppression: "Hide" });
    void work.then(() => { settled = true; }, () => { settled = true; });
    await turn(); assert.equal(settled, false); ack();
    if (fail) { await assert.rejects(work, /begin failed/); assert.equal(f.requests.at(-1).method, "ArdiaShell.cancelDialog"); }
    else assert.deepEqual(await work, { confirmed: true, suppressed: true });
    f.dialogs.retire();
  }
});

test("two windows reject wrong owner, wrong generation, malformed and duplicate results", async () => {
  const a = fixture("a", "1"), b = fixture("b", "2");
  let count = 0;
  const wa = a.dialogs.confirm({ title: "A" }).then((value) => { count++; return value; });
  const wb = b.dialogs.prompt({ title: "B" });
  await turn();
  a.emit({ confirmed: true, suppressed: false }, { windowId: "b" });
  a.emit({ confirmed: true, suppressed: false }, { rendererGeneration: "2" });
  a.emit({ confirmed: "yes", suppressed: false });
  a.emit({ confirmed: true, suppressed: false }, { rendererGeneration: 1 });
  await turn(); assert.equal(count, 0);
  a.emit({ confirmed: false, suppressed: true });
  a.emit({ confirmed: true, suppressed: false });
  b.emit("B value");
  assert.deepEqual(await wa, { confirmed: false, suppressed: false });
  assert.equal(await wb, "B value"); assert.equal(count, 1);
  await assert.rejects(a.dialogs.prompt({ title: "Wrong", windowId: "b" }), /owner/);
  a.dialogs.retire(); b.dialogs.retire();
});

test("bounded queue, retry after failure and retirement safely cancel pending dialogs", async () => {
  const f = fixture();
  const pending = Array.from({ length: 16 }, () => f.dialogs.confirm({ title: "Queue", suppression: "Hide" }));
  await assert.rejects(f.dialogs.confirm({ title: "Overflow" }), /Too many/);
  await turn();
  for (const close of [...f.closing]) close();
  assert.deepEqual(await Promise.all(pending), pending.map(() => ({ confirmed: false, suppressed: false })));
  assert.equal(f.listeners.size, 0);
  await assert.rejects(f.dialogs.prompt({ title: "Retired" }), /unavailable/);
  const retry = fixture();
  const original = retry.host.invoke;
  retry.host.invoke = async () => { throw new Error("failed"); };
  await assert.rejects(retry.dialogs.prompt({ title: "Try" }), /failed/);
  retry.host.invoke = original;
  const work = retry.dialogs.prompt({ title: "Retry" });
  await turn(); retry.emit("ok"); assert.equal(await work, "ok");
  retry.dialogs.retire();
});

test("abort cancels only that request natively and ignores its late confirm", async () => {
  const f = fixture();
  const abort = new AbortController();
  let settlements = 0;
  const aborted = f.dialogs.abortableConfirm({ title: "Close tab?", suppression: "Hide" }, abort.signal).then((value) => { settlements++; return value; });
  await turn();
  const abortedId = requestsFor(f, "beginDialog")[0].args[0].dialogId;
  const sibling = f.dialogs.prompt({ title: "Sibling" });
  await turn();
  abort.abort(); abort.abort();
  assert.deepEqual(await aborted, { confirmed: false, suppressed: false });
  assert.deepEqual(requestsFor(f, "cancelDialog").map((request) => request.args[0]), [abortedId]);
  f.emit({ confirmed: true, suppressed: true }, { dialogId: abortedId });
  await turn(); assert.equal(settlements, 1);
  f.emit("Sibling");
  assert.equal(await sibling, "Sibling");
  f.dialogs.retire();
});

test("suspend cancels pending dialogs and refuses admissions until every token resumes", async () => {
  const f = fixture();
  const pending = f.dialogs.prompt({ title: "Pending" });
  await turn();
  const first = f.dialogs.suspend();
  const second = f.dialogs.suspend();
  await first.settled;
  assert.equal(await pending, null);
  assert.equal(requestsFor(f, "cancelDialog").length, 1);
  for (const forged of [undefined, {}, { settled: second.settled }]) assert.equal(f.dialogs.resume(forged), false);
  assert.equal(f.dialogs.resume(second), true);
  assert.equal(f.dialogs.resume(second), false);
  await assert.rejects(f.dialogs.confirm({ title: "Refused" }), { code: "ERR_DIALOG", message: "Dialogs are suspended for this window" });
  assert.equal(f.dialogs.resume(first), true);
  const work = f.dialogs.prompt({ title: "Re-admitted" });
  await turn(); f.emit("Again"); assert.equal(await work, "Again");
  f.dialogs.retire();
});
