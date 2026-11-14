#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function babelFor(appDirectory) {
  const fromApp = createRequire(resolve(appDirectory, "package.json"));
  const preset = fromApp.resolve("@react-native/babel-preset/package.json", { paths: [fromApp.resolve("babel-preset-expo/package.json")] });
  const fromPreset = createRequire(preset);
  return { babel: fromPreset("@babel/core"), plugin: (name) => fromPreset.resolve(name) };
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
      plugin("@babel/plugin-transform-class-properties"),
      plugin("@babel/plugin-transform-private-methods"),
      plugin("@babel/plugin-transform-classes"),
      plugin("@babel/plugin-transform-block-scoping"),
      plugin("@babel/plugin-transform-async-to-generator"),
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
