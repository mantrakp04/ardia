import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { createSecureContext } from "node:tls";
import { TRUSTED_HOSTS, UNTRUSTED_HOSTS } from "./tls.mjs";
import { createLiveServices, LIVE_HOSTS } from "./liveServices.mjs";

const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const SUGGEST_HOST = "suggestqueries.google.com";
export const FIND_WORD = "needle";

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function suggestionsFor(query) {
  return [`${query} ardia suggestion one`, `${query} ardia suggestion two`, `${query} ardia suggestion three`];
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}

export async function startFixtures({ tls, slowChunk = 16384, slowInterval = 100 } = {}) {
  const requests = [];
  const routes = new Map();
  const gates = new Map();
  const streams = new Set();
  const live = createLiveServices();
  const ports = {};
  const hostOf = (request) => String(request.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  const gate = (name) => {
    if (!gates.has(name)) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      gates.set(name, { promise, release, released: false });
    }
    return gates.get(name);
  };
  const handle = (secure) => (request, response) => {
    const url = new URL(request.url, `${secure ? "https" : "http"}://${request.headers.host ?? "localhost"}`);
    const host = hostOf(request);
    requests.push({ secure, host, path: url.pathname, query: Object.fromEntries(url.searchParams), method: request.method, headers: { ...request.headers }, time: Date.now() });
    const send = (status, type, body, extra = {}) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", ...extra });
      response.end(body);
    };
    const html = (title, body) => send(200, "text/html; charset=utf-8", page(title, body));
    const custom = routes.get(url.pathname);
    if (custom) return custom({ request, response, url, secure, send, html });
    if (secure && LIVE_HOSTS.includes(host)) {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => void live.handle(request, response, Buffer.concat(chunks).toString("utf8")).catch(() => response.destroy()));
      return;
    }
    if (host === SUGGEST_HOST && url.pathname === "/complete/search") {
      const query = url.searchParams.get("q") ?? "";
      return send(200, "application/json; charset=UTF-8", JSON.stringify([query, suggestionsFor(query)]));
    }
    const pageMatch = /^\/page\/(\d+)$/.exec(url.pathname);
    if (pageMatch) return html(`Acceptance page ${pageMatch[1]}`, `<h1>Acceptance page ${pageMatch[1]}</h1><p>${escapeHtml(url.searchParams.get("run") ?? "")}</p>`);
    if (url.pathname === "/find") {
      const count = Math.max(0, Math.min(50, Number(url.searchParams.get("count") ?? 3) | 0));
      const label = url.searchParams.get("label") ?? "find";
      const words = Array.from({ length: count }, (_, i) => `<p>Paragraph ${i + 1} holds the word ${FIND_WORD} once.</p>`).join("");
      return html(`Find ${label}`, `<h1>Find fixture ${escapeHtml(label)}</h1>${words}`);
    }
    if (url.pathname === "/isolation") return html("Isolation fixture", `<h1>Isolation fixture</h1><p id="cookie"></p><script>document.getElementById('cookie').textContent = document.cookie</script>`);
    if (url.pathname === "/secure") return html("Secure fixture", "<h1>Secure fixture</h1>");
    if (url.pathname === "/insecure") return html("Insecure fixture", "<h1>Insecure fixture</h1>");
    if (url.pathname === "/badcert") return html("Bad certificate fixture", "<h1>Bad certificate fixture</h1>");
    if (url.pathname === "/mixed") {
      const image = `http://insecure-image.ardia.test:${ports.http}/pixel.png?mixed=${Date.now()}`;
      const form = `http://insecure-form.ardia.test:${ports.http}/submit`;
      return html("Mixed fixture", `<h1>Mixed fixture</h1><form id="form" method="post" action="${form}"><input name="q"></form><img id="mixed" src="${image}" width="1" height="1">`);
    }
    if (url.pathname === "/print") return html("Print fixture", "<h1>Ardia print fixture</h1><p>Printable text.</p>");
    if (url.pathname === "/zoom") return html("Zoom fixture", "<h1>Zoom fixture</h1>");
    if (url.pathname === "/pixel.png") return send(200, "image/png", PIXEL_PNG);
    const download = /^\/download\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (download) {
      const size = Math.max(1, Math.min(8 << 20, Number(url.searchParams.get("size") ?? 4096) | 0));
      return send(200, "application/octet-stream", Buffer.alloc(size, 0x61), { "content-disposition": `attachment; filename="${download[1]}"`, "content-length": String(size) });
    }
    const slow = /^\/slow\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
    if (slow) {
      const name = slow[1];
      const size = Math.max(slowChunk * 2, Math.min(64 << 20, Number(url.searchParams.get("size") ?? 4 << 20) | 0));
      response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": String(size), "cache-control": "no-store" });
      streams.add(response);
      let written = 0;
      let stopped = false;
      const finish = () => { stopped = true; streams.delete(response); };
      response.on("close", finish);
      const pump = async () => {
        while (!stopped && written < size - slowChunk) {
          const ok = response.write(Buffer.alloc(slowChunk, 0x62));
          written += slowChunk;
          if (!ok) await Promise.race([once(response, "drain"), once(response, "close")]);
          await new Promise((resolve) => setTimeout(resolve, slowInterval));
        }
        if (stopped) return;
        await gate(name).promise;
        if (stopped) return;
        response.end(Buffer.alloc(size - written, 0x62));
        finish();
      };
      void pump().catch(finish);
      return;
    }
    send(404, "text/plain; charset=utf-8", "not found");
  };
  const httpServer = http.createServer(handle(false));
  const contexts = new Map();
  for (const host of TRUSTED_HOSTS) contexts.set(host, createSecureContext(tls.trusted));
  for (const host of UNTRUSTED_HOSTS) contexts.set(host, createSecureContext(tls.untrusted));
  const httpsServer = https.createServer({
    ...tls.trusted,
    SNICallback: (servername, callback) => callback(null, contexts.get(String(servername).toLowerCase()) ?? contexts.get(TRUSTED_HOSTS[0])),
  }, handle(true));
  const sockets = new Set();
  for (const server of [httpServer, httpsServer]) {
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    server.on("secureConnection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  ports.http = httpServer.address().port;
  ports.https = httpsServer.address().port;
  const url = {
    http: (host, path) => `http://${host}:${ports.http}${path}`,
    https: (host, path) => `https://${host}:${ports.https}${path}`,
    page: (n, run = "") => `http://plain.ardia.test:${ports.http}/page/${n}${run ? `?run=${encodeURIComponent(run)}` : ""}`,
    secure: () => `https://secure.ardia.test:${ports.https}/secure`,
    insecure: () => `http://plain.ardia.test:${ports.http}/insecure`,
    mixed: () => `https://mixed.ardia.test:${ports.https}/mixed`,
    badcert: () => `https://badcert.ardia.test:${ports.https}/badcert`,
    find: (count, label) => `http://plain.ardia.test:${ports.http}/find?count=${count}&label=${encodeURIComponent(label)}`,
    isolation: (host = "isolation.ardia.test") => `http://${host}:${ports.http}/isolation`,
    download: (name, size = 4096) => `https://secure.ardia.test:${ports.https}/download/${name}?size=${size}`,
    slow: (name, size = 4 << 20) => `https://secure.ardia.test:${ports.https}/slow/${name}?size=${size}`,
    print: () => `http://plain.ardia.test:${ports.http}/print`,
    zoom: (host = "zoom.ardia.test") => `http://${host}:${ports.http}/zoom`,
  };
  const chromiumArgs = [
    `--host-resolver-rules=MAP *.ardia.test 127.0.0.1, MAP *.ardia-keep.test 127.0.0.1, MAP ${SUGGEST_HOST} 127.0.0.1:${ports.https}, ${LIVE_HOSTS.map((host) => `MAP ${host} 127.0.0.1:${ports.https}`).join(", ")}, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`,
    ...tls.chromiumArgs,
  ];
  return {
    ports,
    url,
    requests,
    chromiumArgs,
    suggestRequests: () => requests.filter((r) => r.host === SUGGEST_HOST),
    live,
    route(path, handler) {
      routes.set(path, handler);
    },
    release(name) {
      const g = gate(name);
      g.released = true;
      g.release();
    },
    async close() {
      for (const g of gates.values()) g.release();
      for (const response of streams) response.destroy();
      for (const socket of sockets) socket.destroy();
      await Promise.all([httpServer, httpsServer].map((server) => new Promise((resolve) => server.close(() => resolve()))));
    },
  };
}
