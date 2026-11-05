#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const HELP = `Usage: node apps/browser/scripts/emoji-data.mjs <emoji-test.txt> <annotations.json> <annotationsDerived.json>

Writes apps/browser/src/lib/emojiData.ts, the emoji the icon picker offers: every fully-qualified emoji up to
MAX_VERSION (what macOS 14, the app's minimum, draws) without skin-tone variants, in Unicode's order and groups,
each with its CLDR short name and CLDR keywords as search words.

Sources:
  https://unicode.org/Public/emoji/15.0/emoji-test.txt
  https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-full/annotations/en/annotations.json
  https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-derived-full/annotationsDerived/en/annotations.json`;

const MAX_VERSION = 15.0;
const OUT = new URL("../src/lib/emojiData.ts", import.meta.url);
const GROUPS = {
  "Smileys & Emotion": "Smileys",
  "People & Body": "People",
  "Animals & Nature": "Animals & Nature",
  "Food & Drink": "Food & Drink",
  Activities: "Activities",
  "Travel & Places": "Travel & Places",
  Objects: "Objects",
  Symbols: "Symbols",
  Flags: "Flags",
};
const ORDER = ["Smileys", "People", "Animals & Nature", "Food & Drink", "Activities", "Travel & Places", "Objects", "Symbols", "Flags"];
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/u;

const args = process.argv.slice(2);
if (args.length !== 3 || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.includes("--help") ? 0 : 1);
}
const [testFile, annotationsFile, derivedFile] = args;

const keywordsOf = (file, key) => JSON.parse(readFileSync(file, "utf8"))[key].annotations;
const keywords = { ...keywordsOf(derivedFile, "annotationsDerived"), ...keywordsOf(annotationsFile, "annotations") };
const bare = (s) => s.replace(/\uFE0F/g, "");
const keywordsByBare = new Map(Object.entries(keywords).map(([k, v]) => [bare(k), v]));

const clean = (text) => text.toLowerCase().replace(/[\t\n]/g, " ").replace(/\s+/g, " ").trim();

function wordsFor(emoji, name) {
  const words = new Set(clean(name).split(/[\s:,]+/));
  const added = [];
  for (const keyword of (keywords[emoji] ?? keywordsByBare.get(bare(emoji)))?.default ?? [])
    for (const word of clean(keyword).split(/[\s:,]+/))
      if (word && !words.has(word)) {
        words.add(word);
        added.push(word);
      }
  return added.join(" ");
}

const byGroup = new Map(ORDER.map((title) => [title, []]));
let group = null;
for (const line of readFileSync(testFile, "utf8").split("\n")) {
  const heading = line.match(/^# group: (.+)$/);
  if (heading) {
    group = GROUPS[heading[1]] ?? null;
    continue;
  }
  const entry = line.match(/^[0-9A-F ]+;\s*fully-qualified\s*# (\S+) E(\d+\.\d+) (.+)$/);
  if (!entry || !group) continue;
  const [, emoji, version, name] = entry;
  if (Number(version) > MAX_VERSION || SKIN_TONE.test(emoji)) continue;
  byGroup.get(group).push([emoji, clean(name), wordsFor(emoji, name)]);
}

const empty = ORDER.filter((title) => !byGroup.get(title).length);
if (empty.length) throw new Error(`no emoji parsed for ${empty.join(", ")}: is ${testFile} Unicode's emoji-test.txt?`);

const escape = (text) => text.replace(/[\\`$]/g, (c) => `\\${c}`);
const body = ORDER.map((title) => {
  const rows = byGroup.get(title).map((cols) => escape(cols.filter((c, i) => i < 2 || c).join("\t")));
  return `  {\n    title: "${title}",\n    list: \`${rows.join("\n")}\`,\n  },`;
}).join("\n");

writeFileSync(OUT, `export const EMOJI_GROUPS: readonly { title: string; list: string }[] = [\n${body}\n];\n`);
const total = [...byGroup.values()].reduce((n, rows) => n + rows.length, 0);
console.log(`${total} emoji in ${ORDER.length} groups → ${OUT.pathname}`);
