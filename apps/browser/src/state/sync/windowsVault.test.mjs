import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FOLDER_UNREADABLE, syncVault } from "../../../../../packages/expo-windows/src/sync/vault.ts";
import { cryptoDouble, nativeDouble } from "./fixtures/windowsSyncDouble.mjs";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const interop = join(repo, "packages/sync/tests/fixtures/windows-interop");
const manifestOf = (name) => JSON.parse(readFileSync(join(interop, `${name}.json`), "utf8"));
const hex = (text) => new Uint8Array(Buffer.from(text, "hex"));
const counts = () => ({ placeholders: 0, busy: 0 });
const scratch = () => mkdtempSync(join(tmpdir(), "ardia-sync-"));
const quoted = (text) => [...text.matchAll(/"([a-z ]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/));

test("the Windows host's wordlist is the Mac's", () => {
  const swift = quoted(readFileSync(join(repo, "packages/sync/ios/Core/Wordlist.swift"), "utf8"));
  const windows = quoted(readFileSync(join(repo, "apps/browser/windows/Ardia/SyncWordlist.h"), "utf8"));
  assert.equal(swift.length, 2048);
  assert.deepEqual(windows, swift);
});

test("the format double matches the Mac's known answers", () => {
  const zero = cryptoDouble(new Uint8Array(32));
  assert.equal(zero.chainTag(), "gbcx4r55mk3rlaegbggknyx4ta");
  assert.equal(zero.scopeTag("app"), "nr4ncp5iyqzqgjn6ol4zksqtne");
  const mac = manifestOf("mac");
  const keys = cryptoDouble(hex(mac.entropy));
  assert.equal(keys.chainTag(), mac.chainTag);
  for (const [scope, tag] of Object.entries(mac.scopeTags)) assert.equal(keys.scopeTag(scope), tag);
  assert.equal(keys.sealPassword(mac.password.password, mac.password.origin, mac.password.username), mac.password.sealed);
  assert.deepEqual(keys.openLocal(mac.local.sealed), { state: "data", payload: mac.local.plain });
});

test("a vault the Mac wrote reads on Windows, with its passwords sealed before they reach JS", async () => {
  const mac = manifestOf("mac");
  const keys = cryptoDouble(hex(mac.entropy));
  const vault = syncVault(nativeDouble(keys), counts());
  const folder = join(interop, "mac");
  assert.equal(await vault.chainStatus(folder), "ok");
  for (const file of mac.files) {
    const listing = await vault.read(folder, file.scope, []);
    assert.deepEqual(listing.damaged, []);
    const read = listing.files.find((f) => f.id === file.id);
    assert.ok(read, `${file.scope} ${file.id}`);
    assert.ok(!read.payload.includes('"p":'), "a plaintext password reached JS");
    const expected = JSON.parse(file.payload);
    const got = JSON.parse(read.payload);
    if (file.scope === "app") {
      const login = got.records["pw:1"].v;
      assert.equal(keys.openPassword(login.s, login.o, login.u), expected.records["pw:1"].v.p);
      assert.equal(keys.openPassword(got["pw:2"].v.s, "https://ardia.dev", "grace"), "battery staple");
    } else assert.deepEqual(got, expected);
  }
});

test("a vault written through the Windows code path keeps the Mac's format (fixtures/windows-interop/windows)", async () => {
  const mac = manifestOf("mac");
  const keys = cryptoDouble(hex(mac.entropy));
  const writing = process.env.ARDIA_WRITE_SYNC_FIXTURES === "1";
  const folder = writing ? join(interop, "windows") : scratch();
  if (writing) rmSync(folder, { recursive: true, force: true });
  const native = nativeDouble(keys);
  const vault = syncVault(native, counts());
  await vault.createChain(folder);
  const files = [];
  for (const file of mac.files) {
    const hidden = keys.opened(keys.scopeTag(file.scope), "x", keys.sealFile(keys.scopeTag(file.scope), "x", file.payload));
    assert.equal(hidden.state, "data");
    const id = await vault.write(folder, file.scope, hidden.payload);
    files.push({ scope: file.scope, id, payload: file.payload });
    const back = (await vault.read(folder, file.scope, [])).files.find((f) => f.id === id);
    assert.equal(back?.payload, hidden.payload);
  }
  if (writing) {
    const manifest = { ...mac, files, local: { plain: mac.local.plain, sealed: keys.sealLocal(mac.local.plain) } };
    writeFileSync(join(interop, "windows.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } else rmSync(folder, { recursive: true, force: true });
  for (const file of manifestOf("windows").files) {
    const read = (await vault.read(join(interop, "windows"), file.scope, [])).files.find((f) => f.id === file.id);
    assert.ok(read && !read.payload.includes('"p":'));
  }
});

test("online-only and busy files wait instead of counting as damaged, and a file seen before is skipped", async () => {
  const mac = manifestOf("mac");
  const keys = cryptoDouble(hex(mac.entropy));
  const folder = scratch();
  cpSync(join(interop, "mac"), folder, { recursive: true });
  const [app, profile] = mac.files;
  const native = nativeDouble(keys, { placeholders: new Set([`${app.id}.nns`]), busy: new Set([`${profile.id}.nns`]) });
  const tally = counts();
  const vault = syncVault(native, tally);
  const first = await vault.read(folder, app.scope, []);
  assert.deepEqual([first.pending, first.files.length, first.present], [[app.id], 0, [app.id]]);
  assert.deepEqual(native.hydrated, [`${app.scope}/${app.id}`]);
  const second = await vault.read(folder, profile.scope, []);
  assert.deepEqual([second.pending, second.damaged], [[profile.id], []]);
  assert.deepEqual(tally, { placeholders: 1, busy: 1 });
  assert.deepEqual((await vault.read(folder, profile.scope, [profile.id])).present, [profile.id]);
  assert.deepEqual(await vault.read(folder, "never-written", []), { files: [], pending: [], damaged: [], present: [] });
  const other = syncVault(nativeDouble(cryptoDouble(new Uint8Array(32))), counts());
  assert.equal(await other.chainStatus(folder), "missing");
  assert.equal(await other.chainStatus(join(folder, "nowhere")), "unavailable");
  await assert.rejects(other.read(folder, "app", []), (error) => error.code === FOLDER_UNREADABLE);
  rmSync(folder, { recursive: true, force: true });
});

test("passwords never reach JS in plaintext, even under escaped keys or in malformed logins", () => {
  const keys = cryptoDouble(new Uint8Array(32));
  const document = '{"\\u0070w:1":{"v":{"o":"https://a.example","u":"ada","p":"escaped secret"}},"list":[{"k":"pw:2","v":{"o":5,"p":"malformed secret"}}],"n":1731500000000}';
  const result = keys.opened("scope", "id", keys.sealFile("scope", "id", document));
  assert.equal(result.state, "data");
  for (const secret of ["escaped secret", "malformed secret"]) assert.ok(!result.payload.includes(secret), secret);
  assert.equal(keys.openPassword(JSON.parse(result.payload)["pw:1"].v.s, "https://a.example", "ada"), "escaped secret");
  assert.equal(JSON.parse(result.payload).n, 1731500000000);
  assert.equal(keys.opened("scope", "other", keys.sealFile("scope", "id", document)).state, "damaged");
});

test("local state whose passwords can't be sealed stays unreadable and blocks writes, as on the Mac", async () => {
  const keys = cryptoDouble(new Uint8Array(32));
  const native = nativeDouble(keys);
  const folder = scratch();
  await native.createChain(folder);
  assert.equal(await native.openLocal(await native.sealLocal('{"ok":1}')), '{"ok":1}');
  const broken = await native.sealLocal('{"pw:1":{"v":{"o":"x","u":"y","p":"z"}');
  assert.equal(await native.openLocal(broken), null);
  assert.equal(native.state.localUnreadable, true);
  await assert.rejects(native.write(folder, "app", "{}"));
  await assert.rejects(native.sealLocal("{}"));
  rmSync(folder, { recursive: true, force: true });
});

test("a native failure while opening a file surfaces instead of marking the file damaged, and ids can't leave the scope", async () => {
  const mac = manifestOf("mac");
  const keys = cryptoDouble(hex(mac.entropy));
  const native = nativeDouble(keys);
  const locked = { ...native, open: () => Promise.reject(new Error("locked")) };
  await assert.rejects(syncVault(locked, counts()).read(join(interop, "mac"), "app", []), /locked/);
  await assert.rejects(native.remove(join(interop, "mac"), "app", "..\\..\\victim"));
  await assert.rejects(syncVault(native, counts()).remove(join(interop, "mac"), "app", ["../../abcdefghijklmnopqrstuvwxyz"]), (error) => error.ids?.length === 1);
});
