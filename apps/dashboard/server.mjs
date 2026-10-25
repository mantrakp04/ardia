import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import start from "./dist/server/server.js";

process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});

const clientDir = fileURLToPath(new URL("./dist/client/", import.meta.url));
const shell = readFileSync(new URL("./dist/client/_shell.html", import.meta.url));
const shellScriptHashes = [...shell.toString("utf8").matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  ([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": [
    "default-src 'self'",
    `script-src 'self' ${shellScriptHashes.join(" ")} https://challenges.cloudflare.com`,
    "frame-src 'self' https://challenges.cloudflare.com",
    "img-src 'self' data: blob: https://ardia.dev https://www.ardia.dev",
    "media-src 'self' data: blob: https://ardia.dev https://www.ardia.dev",
    "font-src 'self' data: blob: https://ardia.dev https://www.ardia.dev",
    "style-src 'self' 'unsafe-inline' data: blob:",
    "connect-src 'self' https://api.hexclave.com https://api1.hexclave.com https://api2.hexclave.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

function withHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function decodedPath(url) {
  const raw = new URL(url).pathname;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const shellResponse = () =>
  new Response(shell, { headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });

const staticFiles = staticMiddleware({ dir: clientDir });

serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  middleware: [
    async (request) => {
      const pathname = decodedPath(request.url);
      if (pathname === null) return new Response("Bad request", { status: 400, headers: SECURITY_HEADERS });
      if (pathname.startsWith("/_serverFn/")) return withHeaders(await start.fetch(request));
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: SECURITY_HEADERS });
      if (pathname.toLowerCase().includes("_shell.html")) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
      if (!pathname.startsWith("/assets/") && !/^\/[\w.-]+\.(png|ico|svg|webp|txt)$/.test(pathname)) return shellResponse();
      const response = await staticFiles(request, () => new Response("Not found", { status: 404 }));
      return withHeaders(response, pathname.startsWith("/assets/") && response.ok ? { "Cache-Control": "public, max-age=31536000, immutable" } : {});
    },
  ],
  fetch: shellResponse,
});
