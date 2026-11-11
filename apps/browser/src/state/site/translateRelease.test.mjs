import assert from "node:assert/strict";
import { test } from "node:test";
const { useTranslate, releaseTranslation, isTranslated } = await import("./translate.ts");

test("a discarded or crashed tab's translation is released at once, whatever it was doing", () => {
  useTranslate.setState({ t1: { status: "translating", source: "fr", target: "en", token: "a" }, t2: { status: "translated", source: "de", target: "en", token: "b" } });
  releaseTranslation("t1");
  releaseTranslation("t2");
  releaseTranslation("t3");
  assert.equal(isTranslated("t1"), false);
  assert.equal(isTranslated("t2"), false);
  assert.deepEqual(useTranslate.getState().t1, { status: "idle", source: "fr" });
  assert.equal(useTranslate.getState().t3, undefined);
});

test("every way a translation ends cancels its model work, once, and a finished pass doesn't", async () => {
  const { cancelEndedTranslations } = await import("./translate.ts");
  const { drainPassages } = await import("./translateDrain.ts");
  useTranslate.setState({ a: undefined, b: undefined, c: undefined, d: undefined });
  const cancelled = [];
  const stop = cancelEndedTranslations((token) => cancelled.push(token));
  useTranslate.setState({ a: { status: "translating", source: "fr", target: "en", token: "A" } });
  useTranslate.setState({ a: { status: "translated", source: "fr", target: "en", token: "A" } });
  assert.deepEqual(cancelled, []);
  releaseTranslation("a");
  releaseTranslation("a");
  assert.deepEqual(cancelled, ["A"]);

  useTranslate.setState({ b: { status: "translating", source: "fr", target: "en", token: "B1" } });
  useTranslate.setState({ b: { status: "translating", source: "fr", target: "ja", token: "B2" } });
  useTranslate.setState({ b: undefined });
  assert.deepEqual(cancelled, ["A", "B1", "B2"]);

  useTranslate.setState({ c: { status: "translating", source: "fr", target: "en", token: "C" } });
  const pending = new Promise(() => {});
  let calls = 0;
  const drained = await drainPassages({
    inFlight: 2,
    holds: () => useTranslate.getState().c?.status === "translating",
    released: new Promise(() => {}),
    next: async () => (calls++ ? { passages: [], more: false, gone: true, done: 0, total: 0 } : { passages: [[1, [[10, "x"]]]], more: true, gone: false, done: 1, total: 2 }),
    translate: () => pending,
    apply: async () => {},
  });
  assert.equal(drained, false);
  useTranslate.setState({ c: { status: "idle", source: "fr" } });
  assert.deepEqual(cancelled, ["A", "B1", "B2", "C"]);
  stop();
});
