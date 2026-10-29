import { homeUrl } from "../data/site";
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /otel/\n\nSitemap: ${new URL("sitemap.xml", homeUrl(site))}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
