import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the native launch reader expects the onboarding.json version onboarding.ts writes", () => {
  const js = Number(read("./onboarding.ts").match(/const DOC_VERSION = (\d+);/)[1]);
  const native = Number(read("../../../../../packages/ardiacore/ios/ArdiaHost+Launch.mm").match(/kOnboardingVersion = (\d+);/)[1]);
  assert.equal(native, js, "bump kOnboardingVersion with DOC_VERSION, and check startedAt/completedAt still mean what the launch reader reads");
});
