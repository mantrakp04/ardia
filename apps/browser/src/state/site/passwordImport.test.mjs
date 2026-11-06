import assert from "node:assert/strict";
import { test } from "node:test";

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const stored = new Map();
const warnings = [];
let csv = [];

const realmOf = (origin) => `${new URL(HAS_SCHEME.test(origin) ? origin : `https://${origin}`).origin}/`;

globalThis.acTestNativeModules = {
  ArdiaPasswords: {
    save: async (_profile, origin, username, password) => {
      const realm = realmOf(origin);
      const key = `${realm} ${username}`;
      if (stored.has(key)) {
        if (stored.get(key) === password) return JSON.stringify({ ok: true });
        throw new Error("A different password is already saved for this login");
      }
      stored.set(key, password);
      if (realm !== `${origin}/`) throw new Error("The password store didn't take the change");
      return JSON.stringify({ ok: true });
    },
  },
};

globalThis.require = (id) => {
  assert.equal(id, "@ardia/import");
  return { chooseImportFile: async () => "/tmp/passwords.csv", importPasswordsCSV: async () => csv };
};

const { importPasswordsCsv } = await import("./savedPasswords.ts");

test("a CSV login whose address has no scheme is saved under its site's origin", async (t) => {
  t.mock.method(console, "warn", (message) => warnings.push(message));
  csv = [
    { url: "example.com/login", username: "ann", password: "pw1" },
    { url: "https://shop.example.org/cart?step=2", username: "bob", password: "pw2" },
  ];
  const result = await importPasswordsCsv("work");
  assert.deepEqual(warnings, []);
  assert.deepEqual(result, { saved: 2, skipped: 0 });
  assert.deepEqual([...stored.keys()].sort(), ["https://example.com/ ann", "https://shop.example.org/ bob"]);
});

test("importing the same CSV again reports every login as saved", async (t) => {
  const warned = [];
  t.mock.method(console, "warn", (message) => warned.push(message));
  const before = [...stored.entries()].sort();
  const result = await importPasswordsCsv("work");
  assert.deepEqual(warned, []);
  assert.deepEqual(result, { saved: 2, skipped: 0 });
  assert.deepEqual([...stored.entries()].sort(), before);
});

test("a login saved with another password is skipped and left as it was", async (t) => {
  const warned = [];
  t.mock.method(console, "warn", (message) => warned.push(message));
  csv = [{ url: "example.com/login", username: "ann", password: "changed" }];
  const result = await importPasswordsCsv("work");
  assert.equal(warned.length, 1);
  assert.deepEqual(result, { saved: 0, skipped: 1 });
  assert.equal(stored.get("https://example.com/ ann"), "pw1");
});
