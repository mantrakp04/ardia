import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("useIconMarks subscribes when it computes the marks itself, and not when they are given", () => {
  const source = readFileSync(new URL("./rowState.ts", import.meta.url), "utf8");
  const hook = source.slice(source.indexOf("export const useIconMarks"));
  assert.match(hook, /useKeyed\(watchTabState, given === undefined \? tabId : null,/);
});
