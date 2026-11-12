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

const EXPO_IMPORT = /import\s+([^;]*?)\s+from\s+["']expo-modules-core["']/g;

function valueImports(source) {
  const names = [];
  for (const [whole, clause] of source.matchAll(EXPO_IMPORT)) {
    if (clause.startsWith("type ")) continue;
    const list = clause.match(/^\{([^}]*)\}$/)?.[1];
    assert.ok(list !== undefined, `only named imports from expo-modules-core are checked, not: ${whole}`);
    for (const item of list.split(",")) {
      const name = item.trim();
      if (name && !name.startsWith("type ")) names.push(name.split(" as ")[0].trim());
    }
  }
  return names;
}

function exportsOf(source) {
  const declared = [...source.matchAll(/export (?:async )?(?:function|const|let|class) (\w+)/g)].map((match) => match[1]);
  const listed = [...source.matchAll(/export \{([^}]+)\}/g)].flatMap((match) => match[1].split(",").map((item) => item.trim().split(" as ").at(-1).trim()));
  return new Set([...declared, ...listed].filter(Boolean));
}

test("everything the app imports from expo-modules-core exists on Windows", () => {
  const onWindows = readFileSync(new URL("packages/expo-windows/src/index.ts", repo), "utf8");
  const exported = exportsOf(onWindows);
  const used = new Set(sourceRoots.flatMap(sources).flatMap((file) => valueImports(readFileSync(file, "utf8"))));
  assert.ok(used.size > 0, "the scan found the app's imports");
  const missing = [...used].filter((name) => !exported.has(name));
  assert.deepEqual(missing, [], "packages/expo-windows/src/index.ts has to export these too");
});
