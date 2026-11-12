import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { emailKey, normalizedEmail } from "./betaEmail.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("an address passes only when it looks like one address, and comes back trimmed", () => {
  for (const ok of ["a@b.co", "first.last+tag@mail.example.org", "o'brien@example.ie", "user@sub.domain.museum", "δοκιμή@παράδειγμα.ελ", `${"x".repeat(64)}@example.com`]) {
    assert.equal(normalizedEmail(ok), ok);
  }
  assert.equal(normalizedEmail("  Someone@Example.com "), "Someone@Example.com");
  const bad = ["", "   ", "plain", "a@b", "a@@b.co", "a@b@c.co", "@b.co", "a@.co", "a@b..co", "a@b.co.", "a b@c.co", "a@b.co\u0000", "a\t@b.co", "zero​width@b.co", `${"x".repeat(65)}@example.com`, `a@${"b".repeat(250)}.co`, 42, null, {}];
  for (const value of bad) assert.equal(normalizedEmail(value), null, JSON.stringify(value));
});

test("the same person has one key whatever the case or the spaces around it", () => {
  assert.equal(emailKey("  Alice@Example.COM "), "alice@example.com");
  assert.equal(emailKey(normalizedEmail(" Alice@Example.com")!), emailKey("alice@example.com"));
});

test("the invite form and the dashboard's reader both judge an address with this one rule", () => {
  const form = read("../scripts/iphone-signup.ts");
  const reader = read("../../../dashboard/src/server/testflight-signups.ts");
  assert.match(form, /import \{[^}]*\bnormalizedEmail\b[^}]*\} from "\.\.\/data\/betaEmail"/);
  assert.match(form, /normalizedEmail\(input\.value\)/);
  assert.doesNotMatch(form, /\.test\(email\)|new RegExp|= \/\^/);
  assert.match(reader, /import \{[^}]*\bnormalizedEmail\b[^}]*\} from "\.\.\/\.\.\/\.\.\/site\/src\/data\/betaEmail\.ts"/);
  assert.doesNotMatch(reader, /function normalizedEmail/);
});
