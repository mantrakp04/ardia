#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8765);
const page = join(here, "index.html");

function lanIPv4() {
  const nets = networkInterfaces();
  for (const rows of Object.values(nets)) {
    for (const row of rows ?? []) {
      if (row.family === "IPv4" && !row.internal) return row.address;
    }
  }
  return null;
}

function usage() {
  console.log(`Serve the secure-context probe for issue #882.

  node apps/browser/scripts/secure-context-repro/serve.mjs

Uses your Mac's LAN IP (not localhost — localhost is already a secure context).

A) Your normal Ardia → open the printed URL → expect isSecureContext false, no clipboard.
B) Scratch Ardia with:
     --switch unsafely-treat-insecure-origin-as-secure=<that origin>
   → expect isSecureContext true and navigator.clipboard as object.
`);
}

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

if (!existsSync(page)) {
  console.error(`missing ${page}`);
  process.exit(1);
}

const ip = lanIPv4();
if (!ip) {
  console.error("no LAN IPv4 address found");
  process.exit(1);
}

const origin = `http://${ip}:${port}`;
const html = readFileSync(page);

const server = createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
    return;
  }
  if (req.url === "/probe.json") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ origin, ip, port }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`serving ${origin}/`);
  console.log("");
  console.log("1) Normal Ardia: open that URL → red / insecure.");
  console.log(`2) Scratch with exception:`);
  console.log(`   --switch unsafely-treat-insecure-origin-as-secure=${origin}`);
  console.log("   → green / secure + clipboard object.");
});
