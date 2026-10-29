import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const shared = fileURLToPath(new URL("../../browser/src/", import.meta.url));

test("production Linux graph selects canonical persistence and one shared Live store", { timeout: 60000 }, async () => {
  let graph;
  const result = await build({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "error",
    build: { write: false },
    plugins: [{
      name: "ardia-linux:test-live-persistence-graph",
      generateBundle() { graph = new Map([...this.getModuleIds()].map((id) => [id, this.getModuleInfo(id)])); },
    }],
  });
  const ids = [...graph.keys()];
  const store = `${shared}state/live/store.ts`;
  const linuxBinding = `${root}src/livePersistence.ts`;
  const defaultBinding = `${shared}platform/livePersistence.ts`;
  assert.deepEqual(ids.filter((id) => id.split("?")[0] === store), [store]);
  assert.deepEqual(ids.filter((id) => id.split("?")[0] === linuxBinding), [linuxBinding]);
  assert.equal(graph.has(defaultBinding), false);
  assert.deepEqual(ids.filter((id) => id.includes("/apps/demo/")), []);
  assert.ok(graph.get(store).importedIds.includes(linuxBinding));
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((output) => output.output).filter((entry) => entry.type === "chunk");
  assert.equal(chunks.filter((chunk) => store in chunk.modules).length, 1);
  assert.equal(chunks.filter((chunk) => linuxBinding in chunk.modules).length, 1);
  assert.equal(chunks.some((chunk) => defaultBinding in chunk.modules), false);
});
