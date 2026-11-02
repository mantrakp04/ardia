import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pageScript = read("../ios/page_script.js");
const webKitScript = read("../ios/WebKitPageScript.swift");
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return text.slice(start, end).split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
};

test("WebKit's page script decides scroll direction with page_script.js's code and thresholds", () => {
  const scroll = (text) => between(text, "const scrollDirection = () => {", "const direction = scrollDirection();");
  assert.equal(scroll(webKitScript), scroll(pageScript));
});

test("WebKit's page script measures scrolling the way page_script.js does", () => {
  const measure = (text) =>
    between(text, "const target = scrollTarget;", "addEventListener(\"resize\"").replace(/\b(send|post)\("scroll"/, "report(\"scroll\"").replace(/\n?try \{|\n?\} catch \(e\) \{\}\n?\};|\n?\}\);/g, "");
  assert.equal(measure(webKitScript), measure(pageScript));
});
