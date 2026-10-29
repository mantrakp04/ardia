import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { chromiumSession, decryptChromium, hostHashed, keyringKey, mozLz4Literal, nssProfile, startFakeKeyring, writeFollowupFixtures } from "../lib/importFollowupFixtures.mjs";
import { i109, i110, i111 } from "../scenarios/i-import-followups.mjs";

const has = (path) => access(path, constants.X_OK).then(() => true, () => false);

describe("import follow-up fixtures", () => {
  let root;
  let fixtures;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-import-followups-"));
    fixtures = await writeFollowupFixtures(join(root, "home"), { nowMs: 1700000000000, keyring: true });
  });
  after(() => rm(root, { recursive: true, force: true }));

  it("writes Chrome cookies hashed with their host, a v10 card and v11 keyring passwords", () => {
    const cookies = new DatabaseSync(join(fixtures.chrome, "Network", "Cookies"), { readOnly: true });
    const rows = cookies.prepare("SELECT host_key, encrypted_value FROM cookies").all();
    cookies.close();
    assert.equal(rows.length, fixtures.expected.chromeCookies);
    for (const row of rows) {
      const plain = decryptChromium(row.encrypted_value);
      assert.deepEqual(plain.subarray(0, 32), hostHashed(row.host_key, "").subarray(0, 32));
      assert.ok(Object.values(fixtures.cookieValues).includes(plain.subarray(32).toString()));
    }
    const web = new DatabaseSync(join(fixtures.chrome, "Web Data"), { readOnly: true });
    assert.equal(decryptChromium(web.prepare("SELECT card_number_encrypted AS n FROM credit_cards").get().n).toString(), fixtures.cardNumber);
    web.close();
    const logins = new DatabaseSync(join(fixtures.chrome, "Login Data"), { readOnly: true });
    const passwords = logins.prepare("SELECT password_value AS p FROM logins").all().map((r) => r.p);
    logins.close();
    assert.ok(passwords.every((p) => Buffer.from(p).subarray(0, 3).toString() === "v11"));
    assert.deepEqual(passwords.map((p) => decryptChromium(p, keyringKey()).toString()), fixtures.keyringPasswords);
    assert.throws(() => decryptChromium(passwords[0]));
  });

  it("builds a cleartext SNSS session and a literal-only mozLz4 block", () => {
    const session = chromiumSession([{ url: "https://a.example/", title: "A" }]);
    assert.equal(session.subarray(0, 4).toString("latin1"), "SNSS");
    assert.equal(session.readUInt32LE(4), 3);
    assert.deepEqual([...session.subarray(-3)], [1, 0, 255]);
    const data = Buffer.from("x".repeat(300));
    const packed = mozLz4Literal(data);
    assert.equal(packed.subarray(0, 8).toString("latin1"), "mozLz40\0");
    assert.equal(packed.readUInt32LE(8), 300);
    assert.equal(packed[12], 0xf0);
    assert.equal(packed[13] + packed[14] + 15, 300);
    assert.deepEqual(packed.subarray(-300), data);
  });

  it("declares its issues, manual steps and leak-checked secrets", () => {
    assert.deepEqual([i109, i110, i111].map((s) => [s.id, s.issue]), [["I109", 109], ["I110", 110], ["I111", 111]]);
    for (const s of [i109, i110, i111]) assert.ok(s.manual.length && s.manual.every((m) => m.reason && m.steps.length));
    assert.ok(fixtures.secrets.includes(fixtures.cardNumber) && fixtures.secrets.length >= 7);
  });

  it("generates NSS key4.db and logins.json when certutil is installed", async (t) => {
    if (!(await has("/usr/bin/certutil"))) return t.skip("certutil is not installed");
    const dir = join(root, "nss");
    await nssProfile(dir, "pw", [{ hostname: "https://n.example", username: "u", password: "p" }]);
    const logins = JSON.parse(await readFile(join(dir, "logins.json"), "utf8")).logins;
    assert.equal(logins.length, 1);
    assert.match(logins[0].encryptedPassword, /^[A-Za-z0-9+/=]+$/);
    await access(join(dir, "key4.db"));
  });

  it("serves a fake Secret Service on a private bus and stops it", async (t) => {
    if (!(await has("/usr/bin/dbus-daemon")) || !(await has("/usr/bin/dbus-send"))) return t.skip("dbus tools are not installed");
    const keyring = await startFakeKeyring(root, { items: [] });
    try {
      const reply = spawnSync("dbus-send", ["--print-reply", `--bus=${keyring.address}`, "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.freedesktop.secrets"], { encoding: "utf8", timeout: 10000 });
      assert.match(reply.stdout, /boolean true/);
    } finally {
      await keyring.stop();
    }
  });
});
