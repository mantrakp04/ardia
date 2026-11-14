#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pinned = JSON.parse(readFileSync(new URL("./sync-babel-pins.json", import.meta.url), "utf8"));

const PLUGINS = [
  "@babel/plugin-transform-class-properties",
  "@babel/plugin-transform-private-methods",
  "@babel/plugin-transform-classes",
  "@babel/plugin-transform-block-scoping",
  "@babel/plugin-transform-async-to-generator",
];

export function babelFor(appDirectory, pins = pinned) {
  const fromApp = createRequire(resolve(appDirectory, "package.json"));
  const expoPreset = fromApp.resolve("babel-preset-expo/package.json");
  const preset = fromApp.resolve("@react-native/babel-preset/package.json", { paths: [expoPreset] });
  const fromPreset = createRequire(preset);
  const fromCore = createRequire(fromPreset.resolve("@babel/core/package.json"));
  const version = (from, name) => JSON.parse(readFileSync(from.resolve(`${name}/package.json`), "utf8")).version;
  const found = {
    "babel-preset-expo": JSON.parse(readFileSync(expoPreset, "utf8")).version,
    "@react-native/babel-preset": JSON.parse(readFileSync(preset, "utf8")).version,
    "@babel/core": version(fromPreset, "@babel/core"),
    "@babel/parser": version(fromCore, "@babel/parser"),
    "@babel/traverse": version(fromCore, "@babel/traverse"),
    "@babel/generator": version(fromCore, "@babel/generator"),
    "@babel/helpers": version(fromCore, "@babel/helpers"),
    ...Object.fromEntries(PLUGINS.map((name) => [name, version(fromPreset, name)])),
  };
  const unchecked = Object.keys(pins).filter((name) => !(name in found));
  if (unchecked.length) throw new Error(`sync-babel-pins.json pins packages the sync bundle build does not use: ${unchecked.join(", ")}`);
  const missing = Object.keys(found).filter((name) => !(name in pins));
  const wrong = Object.keys(found).filter((name) => name in pins && pins[name] !== found[name]);
  if (missing.length || wrong.length) {
    const lines = [...wrong.map((name) => `${name} ${pins[name]} is pinned but ${found[name]} is installed`), ...missing.map((name) => `${name} ${found[name]} has no pin`)];
    throw new Error(`the sync bundle is transpiled only with the Babel it was checked with (packages/phone/android/scripts/sync-babel-pins.json):\n${lines.join("\n")}`);
  }
  return { babel: fromPreset("@babel/core"), plugin: (name) => fromPreset.resolve(name), versions: found };
}

export function transpile(source, appDirectory) {
  const { babel, plugin } = babelFor(appDirectory);
  return babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    sourceType: "script",
    compact: false,
    comments: false,
    plugins: [
      ...PLUGINS.map(plugin),
    ],
  }).code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, appDirectory] = process.argv.slice(2);
  if (!input || !output || !appDirectory) {
    console.error("usage: transpile-sync-bundle.mjs <ardia-sync.js> <out.js> <apps/phone>");
    process.exit(2);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, transpile(readFileSync(input, "utf8"), appDirectory));
}
