import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, crxKey, crxSignedPayload, extensionId, packCrx, parseCrx, storedZip, writeCrx, zipEntries } from "../lib/crx.mjs";

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("a stored zip lists its entries with their data and CRCs", () => {
  const entries = [{ name: "manifest.json", data: Buffer.from('{"a":1}') }, { name: "dir/x.js", data: Buffer.from("x") }];
  const read = zipEntries(storedZip(entries));
  assert.deepEqual(read.map((e) => [e.name, e.data.toString()]), [["manifest.json", '{"a":1}'], ["dir/x.js", "x"]]);
  assert.equal(read[1].crc, crc32(Buffer.from("x")));
});

test("a CRX3 carries its public key, a valid SHA-256 RSA signature and the id derived from the key", () => {
  const key = crxKey();
  const archive = storedZip([{ name: "manifest.json", data: Buffer.from("{}") }]);
  const crx = parseCrx(packCrx(archive, key));
  assert.deepEqual(crx.publicKeyDer, key.publicKeyDer);
  assert.deepEqual(crx.archive, archive);
  assert.ok(verify("sha256", crxSignedPayload(crx.signedHeaderData, crx.archive), { key: crx.publicKeyDer, format: "der", type: "spki" }, crx.signature));
  const id = extensionId(key.publicKeyDer);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal([...crx.crxId].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join(""), id);
  assert.ok(!verify("sha256", crxSignedPayload(crx.signedHeaderData, Buffer.concat([crx.archive, Buffer.from("x")])), { key: crx.publicKeyDer, format: "der", type: "spki" }, crx.signature));
});

test("two versions packed with one key share the extension id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crx-test-"));
  try {
    const key = crxKey();
    for (const version of ["1.0", "2.0"]) {
      await mkdir(join(dir, version, "sub"), { recursive: true });
      await writeFile(join(dir, version, "manifest.json"), JSON.stringify({ version }));
      await writeFile(join(dir, version, "sub", "a.txt"), version);
    }
    const one = await writeCrx(join(dir, "1.0"), join(dir, "one.crx"), key);
    const two = await writeCrx(join(dir, "2.0"), join(dir, "two.crx"), key);
    assert.equal(one.id, two.id);
    const entries = zipEntries(parseCrx(await readFile(two.file)).archive);
    assert.deepEqual(entries.map((e) => e.name), ["manifest.json", "sub/a.txt"]);
    assert.equal(JSON.parse(entries[0].data).version, "2.0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
