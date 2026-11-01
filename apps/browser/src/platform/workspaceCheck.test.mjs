import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("the recovery gate checks the workspace before telemetry or persistence reads it", () => {
  const loader = new URL("../test-loader.mjs", import.meta.url).pathname;
  const documents = new URL("./documents.ts", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    const original = JSON.stringify({version:11});
    const files = new Map([['session.json',original]]);
    const writes = [];
    globalThis.acTestNativeModules={ArdiaDocuments:{readDocument:n=>files.get(n)??null,writeDocumentImmediately:(...args)=>writes.push(args)}};
    const doc=await import(${JSON.stringify(documents)});
    assert.match(doc.workspaceUpgradeError(),/newer Ardia build/);
    assert.match(doc.workspaceUpgradeError(),/newer Ardia build/);
    assert.throws(()=>doc.readDocument('session.json'),/newer Ardia build/);
    assert.equal(files.get('session.json'),original);
    assert.deepEqual(writes,[]);
  `;
  execFileSync(process.execPath, ["--no-warnings", "--import", loader, "--input-type=module", "-e", script], { timeout: 10000 });
});
