import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { base64Url, sha256 } from "./sha256.ts";

test("matches node's SHA-256 across block boundaries and non-ASCII text", () => {
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "héllo ✓ 日本"]) {
    assert.equal(Buffer.from(sha256(text)).toString("hex"), createHash("sha256").update(text).digest("hex"), text.slice(0, 20));
  }
});

test("the PKCE S256 challenge matches RFC 7636's example", () => {
  assert.equal(base64Url(sha256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  for (const n of [1, 2, 3, 4, 5]) {
    const bytes = new Uint8Array(n).map((_, i) => i * 77 + 3);
    assert.equal(base64Url(bytes), Buffer.from(bytes).toString("base64url"));
  }
});
