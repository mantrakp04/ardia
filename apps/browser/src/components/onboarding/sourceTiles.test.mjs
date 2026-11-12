import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceTiles } from "./sourceTiles.ts";
import { PLATFORM_FEATURES as MAC } from "../../lib/platformFeatures.ts";
import { PLATFORM_FEATURES as WINDOWS } from "../../lib/platformFeatures.windows.ts";

const summary = (tiles) => tiles.map((t) => [t.id, t.name, t.found, t.app, t.importId ?? null]);

test("on the Mac a tile is found by its app bundle and keeps the app's path for its icon", () => {
  const installed = new Set(["/Applications/Google Chrome.app", "/Applications/Microsoft Edge Beta.app"]);
  assert.deepEqual(summary(sourceTiles((c) => installed.has(c.app), MAC)), [
    ["arc", "Arc", false, null, null],
    ["dia", "Dia", false, null, null],
    ["chrome", "Chrome", true, "/Applications/Google Chrome.app", null],
    ["safari", "Safari", false, null, null],
    ["firefox", "Firefox", false, null, null],
    ["zen", "Zen", false, null, null],
    ["edge", "Edge Beta", true, "/Applications/Microsoft Edge Beta.app", "edgeBeta"],
  ]);
  assert.equal(sourceTiles(() => false, MAC).find((t) => t.id === "brave")?.name, "Brave or Edge");
  assert.ok(sourceTiles((c) => c.id === "helium", MAC).some((t) => t.id === "helium" && t.found));
});

test("on Windows a tile is found by the import's list, has no app path, and the Mac-only browsers are left out", () => {
  const listed = new Set(["edge", "firefox"]);
  assert.deepEqual(summary(sourceTiles((c) => listed.has(c.importId ?? c.id), WINDOWS)), [
    ["arc", "Arc", false, null, null],
    ["chrome", "Chrome", false, null, null],
    ["firefox", "Firefox", true, null, null],
    ["zen", "Zen", false, null, null],
    ["edge", "Edge", true, null, null],
  ]);
});
