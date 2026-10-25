#!/usr/bin/env node
// Usage: node apps/ios/scripts/update-filter-catalog.mjs [<uBO tag>] [--from <assets.json>] [--check] [--help]
// Writes ArdiaBrowser/Blocking/FilterListCatalog.json from uBlock Origin's assets.json at a release tag (default: the tag
// already in the catalog). The catalog lists every filter list with its group, URLs, default state, languages and update
// interval. The lists themselves are downloaded on the device. --check exits 1 when the catalog differs from a fresh build.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "apps/ios/Packages/ArdiaKit/Sources/ArdiaBrowser/Blocking/FilterListCatalog.json");
const args = process.argv.slice(2);

if (args.includes("--help")) {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((line) => line.startsWith("// "));
  console.log(header.map((line) => line.slice(3)).join("\n"));
  process.exit(0);
}

const check = args.includes("--check");
const fromIndex = args.indexOf("--from");
const from = fromIndex >= 0 ? args[fromIndex + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && (fromIndex < 0 || i !== fromIndex + 1));
const current = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")).ubo : null;
const tag = positional[0] ?? current;
if (!tag) {
  console.error("Give a uBlock Origin tag, for example 1.75.0");
  process.exit(1);
}

const text = from
  ? readFileSync(from, "utf8")
  : await fetch(`https://raw.githubusercontent.com/gorhill/uBlock/${tag}/assets/assets.json`).then((r) => {
      if (!r.ok) throw new Error(`assets.json for ${tag}: HTTP ${r.status}`);
      return r.text();
    });
const assets = JSON.parse(text);

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const https = (url) => typeof url === "string" && url.startsWith("https://");
const lists = Object.entries(assets)
  .filter(([, entry]) => entry.content === "filters")
  .map(([id, entry]) => {
    const urls = [...list(entry.cdnURLs), ...list(entry.contentURL)].filter(https);
    return {
      id,
      title: entry.title ?? id,
      group: entry.group ?? "custom",
      ...(entry.group2 ? { group2: entry.group2 } : {}),
      ...(entry.parent ? { parent: entry.parent } : {}),
      off: entry.off === true,
      ...(entry.lang ? { lang: entry.lang.split(/\s+/).filter((l) => l && l !== "_") } : {}),
      ...(entry.ua ? { ua: entry.ua } : {}),
      ...(entry.tags ? { tags: entry.tags.split(/\s+/).filter(Boolean) } : {}),
      updateAfter: entry.updateAfter ?? 5,
      urls: [...new Set(urls)],
      ...(entry.supportURL ? { supportURL: entry.supportURL } : {}),
      ...(entry.instructionURL ? { instructionURL: entry.instructionURL } : {}),
    };
  })
  .filter((entry) => entry.urls.length > 0);

const catalog = `${JSON.stringify({ ubo: tag, lists }, null, 1)}\n`;
if (check) {
  const same = existsSync(out) && readFileSync(out, "utf8") === catalog;
  if (!same) console.error(`${relative(root, out)} is out of date: run node apps/ios/scripts/update-filter-catalog.mjs ${tag}`);
  process.exit(same ? 0 : 1);
}
writeFileSync(out, catalog);
console.log(`${relative(root, out)}: ${lists.length} lists from uBlock Origin ${tag}`);
