import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../capture/sites");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const dot = (accent) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23${accent}'/%3E%3C/svg%3E`;
const shell = (title, accent, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="${dot(accent)}">
<style>body{margin:0;font:15px -apple-system,system-ui;background:#f6f4ef;color:#222}header{height:72px;box-sizing:border-box;padding:22px 40px;background:#${accent};color:#fff;font-size:22px;font-weight:600}
ul{list-style:none;margin:0;padding:12px 24px}li{display:grid;grid-template-columns:200px 1fr 80px;gap:16px;padding:14px 8px;border-bottom:1px solid #e3ded4}time{color:#888;text-align:right}
.story{display:block;margin:28px 40px 0;height:96px;box-sizing:border-box;padding:18px 24px;border-radius:14px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);color:#1b1b1b;text-decoration:none}
.story b{display:block;font:600 21px Georgia,serif;margin-bottom:8px}.story span{color:#777}</style></head><body>${body}</body></html>`;
const row = (from, subject, at) => `<li><b>${from}</b><span>${subject}</span><time>${at}</time></li>`;
const story = (href, head, from, blank) => `<a class="story" href="${href}"${blank ? ' target="_blank"' : ""}><b>${head}</b><span>${from}</span></a>`;

const SYNTHETIC = {
  "mail.example": shell("(3) Inbox — Mailbox", "3b6fd8", `<header>Inbox</header><ul>${[
    row("Harbor Lines", "Your ferry booking for Saturday", "9:41"),
    row("Book Club", "Next month's pick", "9:12"),
    row("Garden Supply", "Seeds are back in stock", "8:30"),
  ].join("")}</ul>`),
  "chat.example": shell("(12) General — Pinecone", "2f8f5b", `<header># general</header><ul>${[
    row("Juniper", "lunch at noon?", "10:02"),
    row("Basil", "pushed the new build", "9:58"),
  ].join("")}</ul>`),
  "links.example": shell("Ferry links", "2f6f8f", `<header>Ferry links</header>${story("http://slow.example/timetable", "Night ferry timetable", "slow.example · opens in a new tab, answers after 8 s", true)}<label style="display:block;margin:28px 40px 8px;color:#777">Notes</label><textarea style="display:block;margin:0 40px;width:calc(100% - 80px);height:96px;box-sizing:border-box;padding:14px 16px;border:1px solid #d8d2c6;border-radius:12px;font:17px -apple-system,system-ui;background:#fff"></textarea>`),
  "news.example": shell("Morning Digest", "b4532a", `<header>Morning Digest</header>${[
    story("http://lexicon.example/", "Word of the day: meadow", "lexicon.example"),
    story("http://docpad.example/", "Trip plan: a weekend in the hills", "docpad.example · opens in a new tab", true),
    story("http://dailyledger.example/", "The Daily Ledger: the ferry timetable changes", "dailyledger.example"),
  ].join("")}`),
};

createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (host === "slow.example") {
    return setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(shell("Night ferry — Timetable", "1f4e79", `<header>Night ferry timetable</header><ul>${[row("Harbor", "Departs 22:10", "Pier 3"), row("Island", "Arrives 23:40", "Quay"), row("Return", "Departs 05:30", "Pier 1")].join("")}</ul>`));
    }, 8000);
  }
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
}).listen(Number(process.argv[2] || 47247), "127.0.0.1");
