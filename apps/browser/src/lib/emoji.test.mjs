import assert from "node:assert/strict";
import { test } from "node:test";
const { emojiSections, matchesTerms, sameIcon, searchEmoji, searchTerms } = await import("./emoji.ts");

const found = (query) => searchEmoji(searchTerms(query)).map((e) => e.emoji);

test("the picker's emoji are Unicode's groups, without skin-tone variants or the component group", () => {
  const sections = emojiSections();
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Smileys", "People", "Animals & Nature", "Food & Drink", "Activities", "Travel & Places", "Objects", "Symbols", "Flags"],
  );
  const all = sections.flatMap((s) => s.emoji);
  assert.ok(all.length > 1800, `${all.length} emoji`);
  assert.ok(!all.some((e) => /[\u{1F3FB}-\u{1F3FF}]/u.test(e.emoji)));
  assert.ok(all.every((e) => e.emoji && e.name));
  assert.equal(new Set(all.map((e) => e.emoji)).size, all.length);
});

test("search matches every term against the CLDR name, whole words first, then word starts, then its keywords", () => {
  assert.equal(found("red heart")[0], "❤️");
  assert.ok(found("heart").indexOf("❤️") < found("heart").indexOf("🥰"), "a whole word of the name before the start of one");
  assert.ok(found("japan").includes("🇯🇵"));
  assert.equal(found("rock")[0], "🪨");
  assert.ok(found("curacao").includes("🇨🇼"));
  assert.ok(found("reunion").includes("🇷🇪"));
  assert.ok(found("Réunion").includes("🇷🇪"));
  assert.ok(found("happy").includes("😀"));
  assert.deepEqual(found("zzzz"), []);
  assert.equal(found("rocket")[0], "🚀");
  assert.ok(found("rocket").includes("🧑‍🚀"));
});

test("symbols match their name's words and their title", () => {
  assert.ok(matchesTerms("cup.and.saucer.fill Café", searchTerms("saucer")));
  assert.ok(matchesTerms("cup.and.saucer.fill Café", searchTerms("caf")));
  assert.ok(!matchesTerms("cup.and.saucer.fill Café", searchTerms("up")));
});

test("an icon saved with or without the emoji presentation selector is the same icon", () => {
  assert.ok(sameIcon("⭐️", "⭐"));
  assert.ok(!sameIcon("⭐", "🌟"));
  assert.ok(!sameIcon(null, "⭐"));
});
