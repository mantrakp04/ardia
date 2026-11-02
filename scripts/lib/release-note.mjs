#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const KEYS = new Set(["date", "headline", "video"]);

function scalar(raw, where) {
  const text = raw.trim();
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) throw new Error(`${where}: unterminated double-quoted value`);
    return JSON.parse(text);
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new Error(`${where}: unterminated single-quoted value`);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[&*!|>%@`{[]/.test(text) || / #|: /.test(text) || text.endsWith(":")) {
    throw new Error(`${where}: quote this value; YAML reads it as something other than plain text`);
  }
  return text;
}

export function releaseNote(path) {
  const text = readFileSync(path, "utf8");
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!block) throw new Error(`${path} has no --- frontmatter block`);
  const meta = {};
  block[1].split("\n").forEach((line, i) => {
    const where = `${path}:${i + 2}`;
    const field = /^([a-z]+):(.*)$/.exec(line);
    if (!field) throw new Error(`${where}: frontmatter lines are \`key: value\`, one per line`);
    if (!KEYS.has(field[1])) throw new Error(`${where}: unknown key ${field[1]} (date, headline, video)`);
    meta[field[1]] = scalar(field[2], where);
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? "")) throw new Error(`${path} needs date: YYYY-MM-DD`);
  if (!meta.headline) throw new Error(`${path} needs a headline`);
  if (meta.video !== undefined) {
    if (!/^[a-z0-9-]+$/.test(meta.video)) throw new Error(`${path}: video is a file name like fixes-0243n1`);
    const film = new URL(`../../apps/site/public/release-videos/${meta.video}.mp4`, import.meta.url);
    if (!existsSync(film)) throw new Error(`${path}: no apps/site/public/release-videos/${meta.video}.mp4`);
  }
  return { date: meta.date, headline: meta.headline, video: meta.video ?? "", body: text.slice(block[0].length).replace(/^\n+/, "") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [path, field] = process.argv.slice(2);
  if (!path || !["date", "headline", "video", "body"].includes(field)) {
    console.error("usage: release-note.mjs <notes.md> date|headline|video|body");
    process.exit(64);
  }
  try {
    process.stdout.write(`${releaseNote(path)[field]}${field === "body" ? "" : "\n"}`);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
