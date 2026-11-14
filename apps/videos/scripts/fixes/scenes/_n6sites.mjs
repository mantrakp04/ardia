import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../capture/sites");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };

const row = (from, subject, at) => `<li><b>${from}</b><span>${subject}</span><time>${at}</time></li>`;
const page = (title, heading, accent, rows) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23${accent}'/%3E%3C/svg%3E">
<style>body{margin:0;font:15px -apple-system,system-ui;background:#f6f4ef;color:#222}header{padding:22px 32px;background:#${accent};color:#fff;font-size:22px;font-weight:600}
ul{list-style:none;margin:0;padding:12px 24px}li{display:grid;grid-template-columns:200px 1fr 80px;gap:16px;padding:14px 8px;border-bottom:1px solid #e3ded4}time{color:#888;text-align:right}</style></head>
<body><header>${heading}</header><ul>${rows.join("")}</ul></body></html>`;

const SYNTHETIC = {
  "mail.example": page("(3) Inbox — Mailbox", "Inbox", "3b6fd8", [
    row("Harbor Lines", "Your ferry booking for Saturday", "9:41"),
    row("Book Club", "Next month's pick", "9:12"),
    row("Garden Supply", "Seeds are back in stock", "8:30"),
    row("Ridge Trail Society", "Spring cleanup volunteers", "Tue"),
  ]),
  "chat.example": page("(12) General — Pinecone", "# general", "2f8f5b", [
    row("Juniper", "lunch at noon?", "10:02"),
    row("Basil", "pushed the new build", "9:58"),
    row("Clover", "the trail map is updated", "9:40"),
  ]),
};

createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (SYNTHETIC[host] && path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(SYNTHETIC[host]);
  }
  let file = join(root, host, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file.startsWith(join(root, host)) || !existsSync(file)) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}).listen(Number(process.argv[2] || 47246), "127.0.0.1");
