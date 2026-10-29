import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { decryptV10, digestTree, encryptV10, leftoverImportCopies, savedLogins, writeImportFixtures } from "../lib/importFixtures.mjs";

describe("import fixtures", () => {
  let root;
  let fixtures;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-import-fixtures-"));
    fixtures = await writeImportFixtures(join(root, "home"), { largeHistory: 1500 });
  });
  after(() => rm(root, { recursive: true, force: true }));

  it("encrypts with Chromium's basic v10 scheme", () => {
    const blob = encryptV10("secret value");
    assert.equal(blob.subarray(0, 3).toString(), "v10");
    assert.equal((blob.length - 3) % 16, 0);
    assert.equal(decryptV10(blob), "secret value");
    assert.equal(decryptV10(Buffer.from("v11abc")), null);
  });

  it("writes scratch Chrome and Firefox profiles with the advertised contents", async () => {
    const logins = new DatabaseSync(join(fixtures.profiles.chrome, "Login Data"), { readOnly: true });
    const rows = logins.prepare("SELECT username_value, password_value FROM logins").all();
    logins.close();
    assert.equal(rows.filter((r) => decryptV10(r.password_value) !== null).length, fixtures.expected.chromePasswords);
    assert.equal(rows.length, fixtures.expected.chromePasswords + fixtures.expected.keyring);
    const history = new DatabaseSync(join(fixtures.profiles.large, "History"), { readOnly: true });
    assert.equal(history.prepare("SELECT count(*) AS n FROM urls").get().n, 1500);
    history.close();
    const places = new DatabaseSync(join(fixtures.profiles.firefox, "places.sqlite"), { readOnly: true });
    assert.equal(places.prepare("SELECT count(*) AS n FROM moz_bookmarks WHERE type = 1").get().n, fixtures.expected.firefoxLinks);
    places.close();
    const bookmarks = JSON.parse(await readFile(join(fixtures.profiles.chrome, "Bookmarks"), "utf8"));
    const links = (node) => (node.type === "url" ? 1 : (node.children ?? []).reduce((n, c) => n + links(c), 0));
    assert.equal(Object.values(bookmarks.roots).reduce((n, r) => n + links(r), 0), fixtures.expected.chromeLinks);
    assert.match(await readFile(fixtures.csv, "utf8"), /^name,url,username,password,note\n/);
    assert.ok((await readFile(fixtures.html, "utf8")).includes("PERSONAL_TOOLBAR_FOLDER"));
  });

  it("detects changed sources, leftover import copies and reads a saved Login Data copy", async () => {
    const tree = join(root, "tree");
    await mkdir(join(tree, "a"), { recursive: true });
    await writeFile(join(tree, "a", "file"), "one");
    const before = await digestTree(tree);
    await writeFile(join(tree, "a", "file"), "two");
    assert.notEqual((await digestTree(tree))["a/file"], before["a/file"]);
    const tmp = join(root, "tmp");
    await mkdir(join(tmp, "ardia-import-abc123"), { recursive: true });
    await mkdir(join(tmp, "unrelated"), { recursive: true });
    assert.deepEqual(await leftoverImportCopies(tmp), ["ardia-import-abc123"]);
    assert.deepEqual(await leftoverImportCopies(join(root, "missing")), []);
    const saved = await savedLogins(join(fixtures.profiles.chrome, "Login Data"), tmp);
    assert.deepEqual(saved.filter((r) => r.password).map((r) => r.password).sort(), fixtures.secrets.slice(0, 3).sort());
    assert.deepEqual(await savedLogins(join(root, "nope"), tmp), []);
    assert.deepEqual(await leftoverImportCopies(tmp), ["ardia-import-abc123"]);
  });
});
