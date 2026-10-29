import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { keysFor } from "../../../../../engine/ardiacore-linux/tests/sync_reference.mjs";
import { folderLeaks, phraseFromKeyStore } from "../scenarios/f13-sync.mjs";

const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "ardia-f13-"));
  dirs.push(dir);
  return dir;
}

describe("F13 scenario helpers", () => {
  it("accepts a sealed, padded folder and flags plaintext, readable names and unpadded files", async () => {
    const root = await scratch();
    const keys = keysFor(Buffer.alloc(32, 7));
    const scope = join(root, keys.chain, keys.scopeTag("app"));
    await mkdir(scope, { recursive: true });
    await writeFile(join(scope, "aaaaaaaaaaaaaaaaaaaaaaaaaa.nns"), keys.seal("{\"title\":\"Secret Title\"}", keys.scopeTag("app"), "aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assert.deepEqual(await folderLeaks(root, ["Secret Title", "app"]), []);
    await writeFile(join(scope, "bbbbbbbbbbbbbbbbbbbbbbbbbb.nns"), "NNS1 Secret Title");
    await writeFile(join(scope, "Secret Title.nns"), keys.seal("x", keys.scopeTag("app"), "Secret Title"));
    const leaks = await folderLeaks(root, ["Secret Title"]);
    assert.ok(leaks.some((leak) => leak.includes("in the name")));
    assert.ok(leaks.some((leak) => leak.startsWith("Secret Title in")));
    assert.ok(leaks.some((leak) => leak.startsWith("unexpected file")));
  });

  it("reads a test instance's sync key as the recovery phrase", async () => {
    const root = await scratch();
    await mkdir(join(root, "Ardia Sync Keys"));
    await writeFile(join(root, "Ardia Sync Keys", "sync-key-aaaaaaaaaaaaaaaaaaaaaaaaaa"), Buffer.alloc(32, 0));
    assert.equal(await phraseFromKeyStore(root, "aaaaaaaaaaaaaaaaaaaaaaaaaa"), `${"abandon ".repeat(23)}art`);
    await writeFile(join(root, "Ardia Sync Keys", "sync-key-bbbbbbbbbbbbbbbbbbbbbbbbbb"), Buffer.alloc(16, 0));
    await assert.rejects(phraseFromKeyStore(root, "bbbbbbbbbbbbbbbbbbbbbbbbbb"), /holds 16 bytes/);
  });
});
