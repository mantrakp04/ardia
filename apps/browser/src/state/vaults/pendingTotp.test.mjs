import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetPending, pendingFor, PENDING_TOTP_MS, rememberPending } from "./pendingTotp.ts";

const at = 1_000_000;
const entry = (origin, id, when = at, provider = "1password") => ({ origin, provider, id, at: when });

test("nothing is pending for another site, or once three minutes have passed", () => {
  const list = rememberPending([], entry("https://example.com", "a"));
  assert.equal(pendingFor(list, "https://example.org", at + 1), null);
  assert.equal(pendingFor(list, "https://example.com", at + PENDING_TOTP_MS), null);
  assert.equal(pendingFor(list, "https://example.com", at + PENDING_TOTP_MS + 1), null);
  assert.equal(pendingFor(list, "https://example.com", at - 1), null);
});

test("a fill is pending for its whole site until it expires", () => {
  const list = rememberPending([], entry("https://login.example.com", "a"));
  assert.equal(pendingFor(list, "https://example.com", at)?.id, "a");
  assert.equal(pendingFor(list, "https://2fa.example.com", at + PENDING_TOTP_MS - 1)?.id, "a");
});

test("a newer fill on the same site replaces the older one, other sites keep theirs", () => {
  let list = rememberPending([], entry("https://example.com", "old"));
  list = rememberPending(list, entry("https://other.test", "other", at + 10));
  list = rememberPending(list, entry("https://www.example.com", "new", at + 20));
  assert.equal(list.length, 2);
  assert.equal(pendingFor(list, "https://example.com", at + 30)?.id, "new");
  assert.equal(pendingFor(list, "https://other.test", at + 30)?.id, "other");
});

test("expired entries are dropped when something new is remembered", () => {
  const list = rememberPending([entry("https://old.test", "x")], entry("https://new.test", "y", at + PENDING_TOTP_MS + 5));
  assert.deepEqual(list.map((p) => p.id), ["y"]);
});

test("locking a manager forgets its pending codes, signing out of everything forgets all", () => {
  const list = [entry("https://a.test", "a", at, "1password"), entry("https://b.test", "b", at, "bitwarden")];
  assert.deepEqual(forgetPending(list, "1password").map((p) => p.id), ["b"]);
  assert.deepEqual(forgetPending(list), []);
});
