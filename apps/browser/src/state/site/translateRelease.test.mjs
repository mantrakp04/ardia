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
