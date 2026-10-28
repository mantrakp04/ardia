import { getCollection } from "astro:content";
import { newestFirst } from "./versions";

export type Release = {
  version: string;
  date: Date;
  headline: string;
  nightly: boolean;
  summary: string;
  html: string;
  description: string;
  video?: string;
};

const DESCRIPTION_LIMIT = 158;

const sectionName = (raw: string) => raw.replace(/<[^>]+>/g, "").trim();
const sectionSlug = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(\w+);/g, (whole, name: string) => NAMED_ENTITIES[name] ?? whole)
    .replace(/\s+/g, " ")
    .trim();

const tally = (html: string) =>
  html
    .split(/<h2\b[^>]*>/)
    .slice(1)
    .map((chunk) => {
      const name = sectionName(chunk.slice(0, chunk.indexOf("</h2>")));
      const items = (chunk.match(/<li\b/g) ?? []).length;
      return { name, items };
    })
    .filter((s) => s.name !== "Not yet");

const summaryOf = (sections: { name: string; items: number }[]) =>
  sections.map((s) => (s.name === "Faster" ? "faster" : `${s.items} ${s.name.toLowerCase()}`)).join(" · ");

const fit = (text: string, limit = DESCRIPTION_LIMIT) => {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > limit * 0.55) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
};

const wordsOf = (text: string) => new Set(text.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) ?? []);
function echoes(a: string, b: string) {
  const [x, y] = [wordsOf(a), wordsOf(b)];
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

function describe(headline: string, html: string) {
  const intro = html.match(/^\s*<p>([\s\S]*?)<\/p>/)?.[1];
  if (intro) return fit(plainText(intro));
  const leads = [...html.matchAll(/<li>\s*<strong>([\s\S]*?)<\/strong>/g)].map((m) => plainText(m[1]!));
  const items = leads.length ? leads : [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => plainText(m[1]!));
  let text = headline;
  for (const item of items.filter((item) => !echoes(item, headline))) {
    const next = `${text} ${/[.!?…]$/.test(item) ? item : `${item}.`}`;
    if (next.length > DESCRIPTION_LIMIT) return text === headline ? fit(next) : text;
    text = next;
  }
  return text;
}

const asSections = (html: string, level: 2 | 3) =>
  html
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g, (_, inner: string) => `<h${level} class="sec sec-${sectionSlug(sectionName(inner))}">${inner}</h${level}>`)
    .replace(/<table\b/g, '<div class="table-scroll"><table')
    .replace(/<\/table>/g, "</table></div>");

export async function releases(sectionLevel: 2 | 3 = 3): Promise<Release[]> {
  const notes = (await getCollection("releaseNotes")).sort((a, b) => newestFirst(a.id, b.id));
  return notes.map((n) => {
    const raw = n.rendered?.html ?? "";
    return {
      version: n.id,
      date: n.data.date,
      headline: n.data.headline,
      nightly: n.data.channel === "nightly",
      summary: summaryOf(tally(raw)),
      html: asSections(raw, sectionLevel),
      description: describe(n.data.headline, raw),
      video: n.data.video,
    };
  });
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const releasePath = (version: string) => `release-notes/${version}/`;
