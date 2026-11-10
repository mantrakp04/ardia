import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const repo = new URL("../../../../", import.meta.url);
const sourceRoots = ["apps/browser/src/", "apps/browser/index.js", "packages/ardiacore/src/", "packages/shell/src/", "packages/shaders/src/", "packages/import/src/", "packages/sync/src/"];

function sources(path) {
  const url = new URL(path, repo);
  if (!statSync(url).isDirectory()) return [url];
  return readdirSync(url, { recursive: true })
    .filter((name) => /\.(ts|tsx|js)$/.test(name) && !/\.test\./.test(name) && !name.startsWith("test-native"))
    .map((name) => new URL(name, url));
}

function valueImports(source) {
  const names = [];
  for (const [, type, list] of source.matchAll(/import (type )?\{([^}]+)\} from "expo-modules-core"/g)) {
    if (type) continue;
    for (const item of list.split(",")) {
      const name = item.trim();
      if (name && !name.startsWith("type ")) names.push(name.split(" as ")[0]);
    }
  }
  return names;
}

test("everything the app imports from expo-modules-core exists on Windows", () => {
  const onWindows = readFileSync(new URL("packages/expo-windows/src/index.ts", repo), "utf8");
  const exported = new Set([...onWindows.matchAll(/export (?:function|const) (\w+)/g)].map((match) => match[1]));
  const used = new Set(sourceRoots.flatMap(sources).flatMap((file) => valueImports(readFileSync(file, "utf8"))));
  assert.ok(used.size > 0, "the scan found the app's imports");
  const missing = [...used].filter((name) => !exported.has(name));
  assert.deepEqual(missing, [], "packages/expo-windows/src/index.ts has to export these too");
});
