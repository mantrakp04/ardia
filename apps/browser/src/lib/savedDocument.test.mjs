import assert from "node:assert/strict";
import { test } from "node:test";
const { parseSaved, versionedJson, unchanged, upgraded } = await import("./savedDocument.ts");

test("a document without a version runs migration 0 exactly once and comes out at the current version", () => {
  let runs = 0;
  const doc = upgraded({ a: 1 }, 1, { 0: (d) => (runs++, { ...d, b: 2 }) });
  assert.equal(runs, 1);
  assert.deepEqual(doc, { a: 1, b: 2, version: 1 });
});

test("each step runs in order from the saved version", () => {
  const seen = [];
  const doc = upgraded({ version: 1, n: 0 }, 3, { 0: () => assert.fail("v0 step on a v1 doc"), 1: (d) => (seen.push(1), { ...d, n: d.n + 1 }), 2: (d) => (seen.push(2), { ...d, n: d.n * 10 }) });
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(doc, { version: 3, n: 10 });
});

test("the current version reads as it is; a newer one, a missing step or a bad version reads as nothing", () => {
  const current = { version: 2, x: 1 };
  assert.equal(upgraded(current, 2), current);
  assert.equal(upgraded({ version: 3 }, 2, { 0: unchanged, 1: unchanged }), null);
  assert.equal(upgraded({ version: 1 }, 2, { 0: unchanged }), null);
  assert.equal(upgraded({}, 2), null);
  for (const version of [-1, 1.5, NaN, "2", null, Number.MAX_SAFE_INTEGER + 2]) assert.equal(upgraded({ version }, 2, { 0: unchanged, 1: unchanged }), null);
});

test("only plain objects pass, before and after every step", () => {
  for (const doc of [null, [], "x", 3, undefined]) assert.equal(upgraded(doc, 1, { 0: unchanged }), null);
  assert.equal(upgraded({}, 1, { 0: () => [] }), null);
  assert.equal(upgraded({}, 1, { 0: () => null }), null);
});

test("steps are looked up as own keys, and a __proto__ key stays data", () => {
  assert.equal(upgraded({}, 1, Object.create({ 0: unchanged })), null);
  const doc = parseSaved('{"__proto__":{"polluted":true},"a":1}', 1, { 0: unchanged });
  assert.equal(doc.a, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(doc), Object.prototype);
});

test("parse errors and empty documents read as nothing", () => {
  assert.equal(parseSaved(null, 1), null);
  assert.equal(parseSaved("", 1), null);
  assert.equal(parseSaved("{", 1), null);
});

test("a write puts the version last, so the payload can't override it", () => {
  assert.equal(versionedJson({ version: 7, a: 1 }, 2), '{"version":2,"a":1}');
  assert.equal(versionedJson({ version: "0.3.1" }, 1, "schemaVersion"), '{"version":"0.3.1","schemaVersion":1}');
});
