import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const read = (key) => execFileSync(new URL("./legacy-name.sh", import.meta.url).pathname, [key], { encoding: "utf8" }).trim();

test("the release scripts can still read the legacy names out of LegacyMigration.swift", () => {
  assert.match(read("appFileName"), /^\w+\.app$/);
  assert.match(read("appName"), /^\w+$/);
  assert.match(read("bundleId"), /^[\w-]+(\.[\w-]+)+$/);
  assert.equal(read("appFileName"), `${read("appName")}.app`);
});
