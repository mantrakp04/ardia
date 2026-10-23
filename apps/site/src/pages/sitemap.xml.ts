import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const GET: APIRoute = async ({ site }) => {
  const home = new URL(import.meta.env.BASE_URL, site);
  const notes = await getCollection("releaseNotes");
  const lastmod = notes.map((n) => n.data.date.toISOString().slice(0, 10)).sort().at(-1);
  const pages: [string, string | undefined][] = [
    ["", lastmod],
    ["release-notes/", lastmod],
    ["press/", undefined],
  ];
  const urls = pages.map(
    ([path, modified]) => `  <url><loc>${new URL(path, home)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}</url>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
