import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeParam, paramSearch } from "./query-params.ts";

const unescape = (text: string) => text.replace(/\\(.)/gs, (_, c: string) => ({ t: "\t", n: "\n", r: "\r" })[c] ?? c);

test("string parameters use ClickHouse's escaped text format", () => {
  assert.equal(escapeParam("a\\nb"), "a\\\\nb");
  assert.equal(escapeParam("tab\there"), "tab\\there");
  assert.equal(escapeParam("line\nbreak\rreturn"), "line\\nbreak\\rreturn");
  assert.equal(escapeParam("it's"), "it\\'s");
  assert.equal(escapeParam("plain /release-notes?x=1&y=2"), "plain /release-notes?x=1&y=2");
  assert.equal(escapeParam(60), "60");
  assert.equal(escapeParam(0.5), "0.5");
});

test("escaped parameters survive URL encoding and decode back to the input", () => {
  const inputs = ["a\\nb", "back\\slash", "tab\there", "new\nline", "cr\rlf", "quote ' and \" both", "{p0:String}", "x') OR 1=1 --", "日本語 ✓", "\\\\\t\n\r'"];
  const url = new URL("http://clickhouse.invalid/");
  for (const [name, value] of paramSearch(Object.fromEntries(inputs.map((v, i) => [`p${i}`, v])))) url.searchParams.set(name, value);
  const decoded = new URL(url.toString()).searchParams;
  inputs.forEach((input, i) => assert.equal(unescape(decoded.get(`param_p${i}`)!), input));
});
