import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeEmail, MAX_PREVIOUS_USERNAMES, previousUsernames } from "./usernames.ts";

const item = (id, username, updatedAt) => ({ provider: "bitwarden", id, title: id, username, urls: [], ...(updatedAt === undefined ? {} : { updatedAt }) });

test("usernames are deduped without regard to case, ranked by how many logins use them, then by the latest use", () => {
  const items = [item("a", "octo", 1), item("b", "OCTO", 7), item("c", "solo", 9), item("d", "pair", 2), item("e", "pair", 3), item("f", "  ", 4), item("g", "octo", 2)];
  const ranked = previousUsernames(items);
  assert.deepEqual(ranked.map((u) => [u.username, u.count, u.item.id]), [["OCTO", 3, "b"], ["pair", 2, "e"], ["solo", 1, "c"]]);
});

test("an email field puts emails first, keeping the ranking inside each group", () => {
  const items = [item("a", "handle", 1), item("b", "handle", 2), item("c", "me@example.com", 3), item("d", "work@corp.test", 9)];
  assert.deepEqual(previousUsernames(items, { email: true }).map((u) => u.username), ["work@corp.test", "me@example.com", "handle"]);
  assert.deepEqual(previousUsernames(items).map((u) => u.username), ["handle", "work@corp.test", "me@example.com"]);
});

test("the list is capped, and a limit can be passed", () => {
  const items = Array.from({ length: 12 }, (_, i) => item(`i${i}`, `user${i}`, i));
  assert.equal(previousUsernames(items).length, MAX_PREVIOUS_USERNAMES);
  assert.deepEqual(previousUsernames(items, { limit: 2 }).map((u) => u.username), ["user11", "user10"]);
  assert.deepEqual(previousUsernames([]), []);
});

test("email shape is a plain address", () => {
  assert.equal(looksLikeEmail(" me@example.com "), true);
  assert.equal(looksLikeEmail("me@localhost"), false);
  assert.equal(looksLikeEmail("handle"), false);
});
