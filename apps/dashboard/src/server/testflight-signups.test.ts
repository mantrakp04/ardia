import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSignupList, classifyBody, listedObjects, normalizedEmail, type ReadObject } from "./testflight-signups.ts";

const name = (n: number) => `${n.toString(16).padStart(32, "0")}.json`;
const body = (email: unknown, extra: Record<string, unknown> = { website: "" }) => JSON.stringify({ v: 1, email, ...extra });
const object = (n: number, mtime: number, text: string | null | undefined, size = text ? new TextEncoder().encode(text).length : 0): ReadObject => ({ name: name(n), mtime, size, body: text });

test("emails pass only when they look like one address", () => {
  for (const ok of ["a@b.co", "  Someone@Example.com ", "first.last+tag@mail.example.org", `${"x".repeat(64)}@example.com`]) assert.ok(normalizedEmail(ok), ok);
  assert.equal(normalizedEmail("  Someone@Example.com "), "Someone@Example.com");
  for (const bad of ["", "   ", "plain", "a@b", "a@@b.co", "a@b@c.co", "@b.co", "a@.co", "a@b..co", "a@b.co.", "a b@c.co", "a@b.co\u0000", "a\t@b.co", "a​@b.co", `${"x".repeat(65)}@example.com`, `a@${"b".repeat(250)}.co`, 42, null, {}]) {
    assert.equal(normalizedEmail(bad), null, JSON.stringify(bad));
  }
});

test("bodies are sorted into a signup or one junk reason", () => {
  assert.deepEqual(classifyBody(body("a@b.co")), { email: "a@b.co" });
  assert.deepEqual(classifyBody(JSON.stringify({ email: "a@b.co" })), { email: "a@b.co" });
  assert.deepEqual(classifyBody(""), { junk: "empty" });
  assert.deepEqual(classifyBody("  \n"), { junk: "empty" });
  assert.deepEqual(classifyBody("email=a@b.co"), { junk: "not-json" });
  assert.deepEqual(classifyBody("[1,2]"), { junk: "not-object" });
  assert.deepEqual(classifyBody("null"), { junk: "not-object" });
  assert.deepEqual(classifyBody('"a@b.co"'), { junk: "not-object" });
  assert.deepEqual(classifyBody(JSON.stringify({ v: 1 })), { junk: "no-email" });
  assert.deepEqual(classifyBody(body(["a@b.co"])), { junk: "no-email" });
  assert.deepEqual(classifyBody(body("nope")), { junk: "bad-email" });
  assert.deepEqual(classifyBody(body("a@b.co", { website: "http://spam.example" })), { junk: "honeypot" });
  assert.deepEqual(classifyBody(body("a@b.co", { website: null })), { junk: "honeypot" });
  assert.deepEqual(classifyBody(body("a@b.co", { website: " " })), { junk: "honeypot" });
});

test("the same person is folded by trimmed lowercase email, keeping the first time and spelling and every object", () => {
  const list = buildSignupList([
    object(3, 3000, body("ALICE@example.com ")),
    object(1, 1000, body(" Alice@Example.com")),
    object(2, 2000, body("bob@example.com")),
    object(4, 4000, body("alice@example.com")),
  ]);
  assert.deepEqual(
    list.signups.map((s) => [s.email, s.key, s.at, s.objects]),
    [
      ["bob@example.com", "bob@example.com", 2000, [name(2)]],
      ["Alice@Example.com", "alice@example.com", 1000, [name(1), name(3), name(4)]],
    ],
  );
  assert.equal(list.scanned, 4);
});

test("objects are judged by name and listed size before their body", () => {
  const list = buildSignupList([
    { name: "notes.json", mtime: 1, size: 20, body: body("x@y.co") },
    { name: `${"A".repeat(32)}.json`, mtime: 1, size: 20, body: body("x@y.co") },
    { name: name(9).replace(".json", ".txt"), mtime: 1, size: 20, body: body("x@y.co") },
    object(1, 10, undefined, 0),
    object(2, 20, undefined, 1025),
    object(3, 30, "x".repeat(1100), 900),
    object(4, 40, null, 40),
    object(5, 50, body("ok@example.com")),
  ]);
  assert.equal(list.scanned, 5);
  assert.equal(list.junk.empty, 1);
  assert.equal(list.junk["too-large"], 2);
  assert.equal(list.unreadable, 1);
  assert.deepEqual(list.signups.map((s) => s.email), ["ok@example.com"]);
});

test("junk is counted per reason and newest signups come first", () => {
  const list = buildSignupList([
    object(1, 100, body("old@example.com")),
    object(2, 300, body("new@example.com")),
    object(3, 200, body("mid@example.com")),
    object(4, 400, "{"),
    object(5, 500, "[]"),
    object(6, 600, body("bot@example.com", { website: "x" })),
    object(7, 700, body("not an email")),
    object(8, 800, body(7)),
  ]);
  assert.deepEqual(list.signups.map((s) => s.email), ["new@example.com", "mid@example.com", "old@example.com"]);
  assert.deepEqual(list.junk, { empty: 0, "too-large": 0, "not-json": 1, "not-object": 1, "no-email": 1, "bad-email": 1, honeypot: 1 });
});

test("filer listings keep only signup objects with their size and modification time", () => {
  const entries = listedObjects([
    { FullPath: `/buckets/testflight/${name(1)}`, Mtime: "2026-11-10T08:00:00Z", FileSize: 60 },
    { FullPath: `/buckets/testflight/${name(2)}`, Mtime: "garbage", FileSize: "12" },
    { FullPath: "/buckets/testflight/sub", Mtime: "2026-11-10T08:00:00Z", FileSize: 0 },
    { FullPath: 12 },
    null,
  ]);
  assert.deepEqual(entries, [
    { name: name(1), size: 60, mtime: Date.parse("2026-11-10T08:00:00Z") },
    { name: name(2), size: 12, mtime: 0 },
  ]);
  assert.deepEqual(listedObjects(null), []);
});
