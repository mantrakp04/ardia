import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { babelFor } from "./transpile-sync-bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const phoneApp = resolve(here, "../../../../apps/phone");
const pins = JSON.parse(readFileSync(resolve(here, "sync-babel-pins.json"), "utf8"));

test("the pinned Babel is the one the app resolves", () => {
  assert.doesNotThrow(() => babelFor(phoneApp, pins));
});

test("any other version of a pinned package stops the build and names it", () => {
  for (const name of Object.keys(pins)) {
    assert.throws(() => babelFor(phoneApp, { ...pins, [name]: "0.0.1" }), (error) => error.message.includes(`${name} 0.0.1`));
  }
});

test("a pin for a package the build does not check is refused", () => {
  assert.throws(() => babelFor(phoneApp, { ...pins, "@babel/plugin-transform-spread": "7.29.7" }), /plugin-transform-spread/);
});
