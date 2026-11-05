import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { releaseNote } from "./release-note.mjs";

const notesDir = new URL("../../docs/release-notes/", import.meta.url).pathname;
const note = (frontmatter) => {
  const path = join(mkdtempSync(join(tmpdir(), "ac-note-")), "0.0.1.md");
  writeFileSync(path, `---\n${frontmatter}\n---\n\n## Fixed\n`);
  return path;
};

test("every release note's frontmatter reads", () => {
  for (const name of readdirSync(notesDir).filter((n) => /^\d.*\.md$/.test(n))) {
    const { date, headline } = releaseNote(join(notesDir, name));
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, name);
    assert.ok(headline, name);
  }
});

test("a quoted headline loses its quotes, as YAML reads it", () => {
  assert.equal(releaseNote(note('date: 2026-01-01\nheadline: "Tabs: they nap now."')).headline, "Tabs: they nap now.");
  assert.equal(releaseNote(note("date: 2026-01-01\nheadline: 'It''s fine.'")).headline, "It's fine.");
});

test("a value YAML would read differently, an unknown key or a missing film is refused", () => {
  assert.throws(() => releaseNote(note("date: 2026-01-01\nheadline: Tabs: they nap now.")), /quote this value/);
  assert.throws(() => releaseNote(note("date: 2026-01-01\nheadline: x\nchannel: nightly")), /unknown key channel/);
  assert.throws(() => releaseNote(note("date: 2026-01-01\nheadline: x\nvideo: no-such-film")), /no apps\/site\/public\/release-videos/);
});
