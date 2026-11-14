import { EMOJI_GROUPS } from "./emojiData";

export type EmojiEntry = { emoji: string; name: string; nameWords: string; words: string };
export type EmojiSection = { title: string; emoji: EmojiEntry[] };

let sections: EmojiSection[] | null = null;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const wordsOf = (text: string) => ` ${fold(text).replace(/[.,:]/g, " ")}`;

export function emojiSections(): EmojiSection[] {
  sections ??= EMOJI_GROUPS.map(({ title, list }) => ({
    title,
    emoji: list.split("\n").map((line) => {
      const [emoji = "", name = "", words = ""] = line.split("\t");
      return { emoji, name, nameWords: wordsOf(name), words: ` ${fold(words)}` };
    }),
  }));
  return sections;
}

export const searchTerms = (query: string): string[] =>
  fold(query)
    .trim()
    .split(/[\s.,:]+/)
    .filter(Boolean);

const hasTerms = (words: string, terms: string[]) => terms.every((term) => words.includes(` ${term}`));

export const matchesTerms = (text: string, terms: string[]) => hasTerms(wordsOf(text), terms);

export function searchEmoji(terms: string[]): EmojiEntry[] {
  const byWord: EmojiEntry[] = [];
  const byName: EmojiEntry[] = [];
  const byKeyword: EmojiEntry[] = [];
  for (const section of emojiSections())
    for (const entry of section.emoji) {
      if (terms.every((term) => `${entry.nameWords} `.includes(` ${term} `))) byWord.push(entry);
      else if (hasTerms(entry.nameWords, terms)) byName.push(entry);
      else if (hasTerms(entry.nameWords + entry.words, terms)) byKeyword.push(entry);
    }
  return [...byWord, ...byName, ...byKeyword];
}

const bare = (icon: string) => icon.replace(/️/g, "");

export const sameIcon = (a: string | null, b: string | null) => a === b || (!!a && !!b && bare(a) === bare(b));
