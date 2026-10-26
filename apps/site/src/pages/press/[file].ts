import type { APIRoute, GetStaticPaths } from "astro";
import { PRESS_FILES, pressFile } from "../../data/press";

export const getStaticPaths: GetStaticPaths = () => PRESS_FILES.map((file) => ({ params: { file } }));

const TYPES: Record<string, string> = { png: "image/png", svg: "image/svg+xml" };

export const GET: APIRoute = async ({ params }) => {
  const file = params.file!;
  return new Response(new Uint8Array(await pressFile(file)), {
    headers: { "Content-Type": TYPES[file.split(".").pop()!] ?? "application/octet-stream" },
  });
};
