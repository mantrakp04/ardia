import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerFor } from "./admin-gate.ts";

const base = { primaryEmail: "Owner@Example.com", primaryEmailVerified: true };

test("signed out", () => assert.deepEqual(viewerFor(null), { state: "signed-out" }));
test("allowed with is_admin true", () =>
  assert.deepEqual(viewerFor({ ...base, clientReadOnlyMetadata: { is_admin: true, other: 1 } }), { state: "allowed", email: "owner@example.com" }));
test("denied without flag", () =>
  assert.deepEqual(viewerFor({ ...base, clientReadOnlyMetadata: {} }), { state: "denied", email: "owner@example.com" }));
test("denied with null metadata", () => assert.equal(viewerFor({ ...base, clientReadOnlyMetadata: null }).state, "denied"));
test("denied with truthy non-true flag", () => {
  for (const v of ["true", 1, "yes", [true]]) assert.equal(viewerFor({ ...base, clientReadOnlyMetadata: { is_admin: v } }).state, "denied");
});
test("denied for unverified email even with flag", () =>
  assert.equal(viewerFor({ ...base, primaryEmailVerified: false, clientReadOnlyMetadata: { is_admin: true } }).state, "denied"));
test("denied with no email even with flag", () =>
  assert.equal(viewerFor({ primaryEmail: null, primaryEmailVerified: true, clientReadOnlyMetadata: { is_admin: true } }).state, "denied"));
test("plain clientMetadata flag does not grant access", () =>
  assert.equal(viewerFor({ ...base, clientMetadata: { is_admin: true }, clientReadOnlyMetadata: {} } as any).state, "denied"));
