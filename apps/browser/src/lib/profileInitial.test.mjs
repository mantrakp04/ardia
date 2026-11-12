import assert from "node:assert/strict";
import { test } from "node:test";
import { profileInitial, profileMark } from "./profileInitial.ts";

test("profiles without explicit icons retain their initials", () => {
  assert.equal(profileMark({ name: "Work", icon: null }), "W");
  assert.equal(profileMark({ name: " personal " }), "P");
  assert.equal(profileMark({ name: "School", icon: "" }), "S");
});

test("explicit symbols and emoji take precedence", () => {
  assert.equal(profileMark({ name: "Work", icon: "symbol:briefcase.fill" }), "symbol:briefcase.fill");
  assert.equal(profileMark({ name: "Work", icon: "💼" }), "💼");
});

test("initials preserve Unicode characters and handle empty names", () => {
  assert.equal(profileInitial("  "), "?");
  assert.equal(profileInitial("école"), "É");
  assert.equal(profileInitial("e\u0301cole"), "É");
  assert.equal(profileInitial("💼 Work"), "💼");
});
