import assert from "node:assert/strict";
import { test } from "node:test";

export const SUBSET = new Set([
  "type", "enum", "const", "default", "description", "minimum", "maximum", "exclusiveMinimum", "pattern", "items", "prefixItems",
  "minItems", "maxItems", "properties", "additionalProperties", "propertyNames", "required", "anyOf",
]);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const typeIs = (type, v) =>
  type === "null" ? v === null
  : type === "array" ? Array.isArray(v)
  : type === "object" ? isObject(v)
  : type === "integer" ? Number.isInteger(v)
  : typeof v === type;

export function accepts(schema, v) {
  if (schema === true) return true;
  if (schema === false) return false;
  if (schema.anyOf && !schema.anyOf.some((s) => accepts(s, v))) return false;
  if (schema.type && ![schema.type].flat().some((t) => typeIs(t, v))) return false;
  if (schema.enum && !schema.enum.some((e) => same(e, v))) return false;
  if ("const" in schema && !same(schema.const, v)) return false;
  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) return false;
    if (schema.maximum !== undefined && v > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && v <= schema.exclusiveMinimum) return false;
  }
  if (typeof v === "string" && schema.pattern && !new RegExp(schema.pattern).test(v)) return false;
  if (Array.isArray(v)) {
    const prefix = schema.prefixItems ?? [];
    if (!prefix.every((s, i) => i >= v.length || accepts(s, v[i]))) return false;
    if (schema.items !== undefined && !v.slice(prefix.length).every((x) => accepts(schema.items, x))) return false;
    if (schema.minItems !== undefined && v.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && v.length > schema.maxItems) return false;
  }
  if (isObject(v)) {
    if (schema.required && !schema.required.every((k) => Object.hasOwn(v, k))) return false;
    for (const [k, x] of Object.entries(v)) {
      if (schema.propertyNames && !accepts(schema.propertyNames, k)) return false;
      if (schema.properties && Object.hasOwn(schema.properties, k)) {
        if (!accepts(schema.properties[k], x)) return false;
      } else if (schema.additionalProperties !== undefined && !accepts(schema.additionalProperties, x)) return false;
    }
  }
  return true;
}

export function keywordsOutsideSubset(schema, at = "", root = true) {
  if (typeof schema === "boolean") return [];
  const found = [];
  for (const [key, value] of Object.entries(schema)) {
    if (root && key === "$schema") continue;
    if (!SUBSET.has(key)) found.push(`${at}/${key}`);
    if (key === "properties") for (const [name, sub] of Object.entries(value)) found.push(...keywordsOutsideSubset(sub, `${at}/properties/${name}`, false));
    if (key === "items" || key === "additionalProperties" || key === "propertyNames") found.push(...keywordsOutsideSubset(value, `${at}/${key}`, false));
    if (key === "prefixItems" || key === "anyOf") value.forEach((sub, i) => found.push(...keywordsOutsideSubset(sub, `${at}/${key}/${i}`, false)));
  }
  return found;
}

test("the subset checker reads the keywords the way JSON Schema does", () => {
  assert.equal(accepts({ type: ["number", "null"], exclusiveMinimum: 0 }, null), true);
  assert.equal(accepts({ type: ["number", "null"], exclusiveMinimum: 0 }, 0), false);
  assert.equal(accepts({ type: "array", prefixItems: [{ type: "number" }], minItems: 1, maxItems: 1 }, [1, 2]), false);
  assert.equal(accepts({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }, { b: 1 }), false);
  assert.deepEqual(keywordsOutsideSubset({ $schema: "x", type: "object", title: "no" }), ["/title"]);
});
