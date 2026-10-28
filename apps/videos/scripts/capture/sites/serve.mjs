import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav", ".mp4": "video/mp4" };
createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, host, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file.startsWith(join(root, host)) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  const body = readFileSync(file);
  const head = { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store", "accept-ranges": "bytes" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (!range) {
    res.writeHead(200, { ...head, "content-length": body.length });
    return res.end(body);
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  res.writeHead(206, { ...head, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${body.length}` });
  res.end(body.subarray(start, end + 1));
}).listen(Number(process.argv[2] || 47231), "127.0.0.1");
