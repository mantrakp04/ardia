import type { APIRoute } from "astro";
import { pressZip } from "../../lib/pressAssets";

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await pressZip()), { headers: { "Content-Type": "application/zip" } });
