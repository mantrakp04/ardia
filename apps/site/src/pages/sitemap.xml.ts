import type { APIRoute } from "astro";
import { bench } from "../data/bench";
import { isoDate, releasePath, releases } from "../data/releaseNotes";
import { PAGES, homeUrl } from "../data/site";

export const GET: APIRoute = async ({ site }) => {
  const home = homeUrl(site);
  const all = await releases();
  const stable = all.filter((r) => !r.nightly);
  const newest = stable.map((r) => isoDate(r.date)).sort().at(-1);
  const newestNote = all.map((r) => isoDate(r.date)).sort().at(-1);
  const pages: [string, string | undefined][] = [
    [PAGES.home, newest],
    [PAGES.try, undefined],
    [PAGES.arc, undefined],
    [PAGES.benchmarks, bench && !bench.sample ? bench.measured : undefined],
    [PAGES.notes, newestNote],
    ...stable.map((r): [string, string] => [releasePath(r.version), isoDate(r.date)]),
    [PAGES.press, undefined],
    [PAGES.privacy, undefined],
    [PAGES.terms, undefined],
  ];
  const urls = pages.map(
    ([path, modified]) => `  <url><loc>${new URL(path, home)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}</url>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
