import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { createSecureContext } from "node:tls";
import { TRUSTED_HOSTS, UNTRUSTED_HOSTS } from "./tls.mjs";
import { createLiveServices, LIVE_HOSTS } from "./liveServices.mjs";

export const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const SUGGEST_HOST = "suggestqueries.google.com";
export const FIND_WORD = "needle";
export const MEDIA_TITLE = "Acceptance tone";

export function toneWav({ seconds = 8, rate = 8000, frequency = 440 } = {}) {
  const samples = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 12000), 44 + i * 2);
  return wav;
}

const MEDIA_SCRIPT = `
const audio = document.getElementById("tone");
window.mediaLog = [];
navigator.mediaSession.metadata = new MediaMetadata({ title: ${JSON.stringify(MEDIA_TITLE)}, artist: "Ardia", album: "Fixture", artwork: [{ src: "/pixel.png", sizes: "1x1", type: "image/png" }] });
for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekto"]) {
  navigator.mediaSession.setActionHandler(action, (details) => {
    window.mediaLog.push(action);
    if (action === "play") audio.play();
    if (action === "pause") audio.pause();
    if (action === "seekto") audio.currentTime = details.seekTime;
  });
}
window.startTone = () => audio.play().then(() => true, (error) => String(error));
`;

const SILENT_VIDEO_SCRIPT = `
const canvas = document.getElementById("canvas");
const context = canvas.getContext("2d");
let frame = 0;
setInterval(() => { context.fillStyle = frame++ % 2 ? "#204060" : "#406020"; context.fillRect(0, 0, 320, 180); }, 50);
for (const id of ["big", "small"]) document.getElementById(id).srcObject = canvas.captureStream(20);
`;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function suggestionsFor(query) {
  return [`${query} ardia suggestion one`, `${query} ardia suggestion two`, `${query} ardia suggestion three`];
}

function page(title, body, head = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${head}</head><body>${body}</body></html>`;
}

export async function startFixtures({ tls, slowChunk = 16384, slowInterval = 100 } = {}) {
  const requests = [];
  const routes = new Map();
  const gates = new Map();
  const streams = new Set();
  const live = createLiveServices();
  const ports = {};
  let links;
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
    const html = (title, body, head) => send(200, "text/html; charset=utf-8", page(title, body, head));
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
    if (url.pathname === "/media") return html("Media fixture", `<h1>Media fixture</h1><audio id="tone" src="/tone.wav" loop></audio><form><input id="field" name="field" autocomplete="off"></form><script>${MEDIA_SCRIPT}</script>`);
    if (url.pathname === "/silent-video") return html("Silent video fixture", `<h1>Silent video fixture</h1><canvas id="canvas" width="320" height="180"></canvas><video id="big" muted autoplay playsinline width="320" height="180"></video><video id="small" muted autoplay playsinline width="80" height="45"></video><script>${SILENT_VIDEO_SCRIPT}</script>`);
    if (url.pathname === "/tone.wav") return send(200, "audio/wav", toneWav());
    if (url.pathname === "/pixel.png") return send(200, "image/png", PIXEL_PNG);
    if (url.pathname.startsWith("/ads/banners/")) return send(200, "image/png", PIXEL_PNG);
    if (url.pathname === "/storage") {
      const name = url.searchParams.get("set");
      const set = name && /^[A-Za-z0-9_-]{1,40}$/.test(name)
        ? `<script>document.cookie = ${JSON.stringify(`${name}=1; max-age=86400; path=/`)}; localStorage.setItem(${JSON.stringify(name)}, "1");</script>`
        : "";
      return html("Storage fixture", `<h1>Storage fixture</h1>${set}`);
    }
    if (url.pathname === "/permissions") return html("Permissions fixture", "<h1>Permissions fixture</h1>");
    if (url.pathname === "/blocker") {
      const run = String(url.searchParams.get("run") ?? "").replace(/[^A-Za-z0-9_-]/g, "");
      return html("Blocker fixture", `<h1>Blocker fixture</h1><img id="ad" src="/ads/banners/${run}.png" width="1" height="1"><img id="control" src="/pixel.png?blocker=${run}" width="1" height="1">`);
    }
    if (url.pathname === "/fullscreen") return html("Fullscreen fixture", `<h1>Fullscreen fixture</h1><video id="video" width="160" height="90"></video>`);
    if (url.pathname === "/hover") return html("Hover fixture", `<a id="link" href="/page/5?hover=${escapeHtml(url.searchParams.get("run") ?? "")}" style="position:absolute;left:20px;top:20px;width:300px;height:120px;display:block;font-size:48px">Hover link</a>`);
    if (url.pathname === "/popup") return html("Popup fixture", `<h1>Popup fixture</h1><script>window.open(${JSON.stringify(`http://plain.ardia.test:${ports.http}/page/8?popup=${encodeURIComponent(url.searchParams.get("run") ?? "")}`)})</script>`);
    if (url.pathname === "/busy") return html("Busy fixture", `<h1>Busy fixture</h1><script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 200))</script>`);
    if (url.pathname === "/gestures") {
      const run = url.searchParams.get("run") ?? "";
      return html("Gestures fixture", `<a id="link" href="${escapeHtml(links.page(6, run))}" style="display:block;width:320px;height:60px;font-size:32px">Peek link</a><iframe id="frame" src="${escapeHtml(links.gestureFrame(run))}" width="400" height="120" style="border:0"></iframe><p id="words">Ardia selects quoted words</p><textarea id="field">alpha beta alpha</textarea><div id="tall" style="height:4000px"></div>`);
    }
    if (url.pathname === "/gesture-frame") return html("Gesture frame", `<a id="link" href="${escapeHtml(links.page(7, url.searchParams.get("run") ?? ""))}" style="display:block;width:320px;height:60px;font-size:32px">Framed link</a>`);
    const tint = /^\/tint\/(meta|header|background|plain)$/.exec(url.pathname);
    if (tint) {
      if (tint[1] === "meta") return html("Tint meta", "<h1>Tint meta</h1>", '<meta name="theme-color" content="#336699">');
      if (tint[1] === "header") return html("Tint header", '<style>body{margin:0}</style><header style="position:sticky;top:0;height:120px;background:#aa2244"></header><h1>Tint header</h1>');
      if (tint[1] === "background") return send(200, "text/html; charset=utf-8", '<!doctype html><html><head><title>Tint background</title></head><body style="background:#22aa66"><h1>Tint background</h1></body></html>');
      return html("Tint plain", "<h1>Tint plain</h1>");
    }
    const favicon = /^\/favicon\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (favicon) return html(`Favicon ${favicon[1]}`, `<h1>Favicon ${escapeHtml(favicon[1])}</h1>`, `<link rel="icon" href="/icon/${favicon[1]}.png">`);
    const icon = /^\/icon\/([A-Za-z0-9_-]+)\.png$/.exec(url.pathname);
    if (icon) return icon[1].startsWith("bad") ? send(200, "image/png", "not an image") : send(200, "image/png", PIXEL_PNG);
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
    storage: (host, set) => `http://${host}:${ports.http}/storage${set ? `?set=${encodeURIComponent(set)}` : ""}`,
    permissions: () => `https://secure.ardia.test:${ports.https}/permissions`,
    permissionsOrigin: () => `https://secure.ardia.test:${ports.https}`,
    blocker: (host, run) => `http://${host}:${ports.http}/blocker?run=${encodeURIComponent(run)}`,
    silentVideo: (run = "") => `http://media.ardia.test:${ports.http}/silent-video?run=${encodeURIComponent(run)}`,
    fullscreen: (run = "") => `http://plain.ardia.test:${ports.http}/fullscreen?run=${encodeURIComponent(run)}`,
    hover: (run = "") => `http://plain.ardia.test:${ports.http}/hover?run=${encodeURIComponent(run)}`,
    popup: (run = "") => `http://plain.ardia.test:${ports.http}/popup?run=${encodeURIComponent(run)}`,
    popupTarget: (run = "") => `http://plain.ardia.test:${ports.http}/page/8?popup=${encodeURIComponent(run)}`,
    busy: (run = "") => `http://plain.ardia.test:${ports.http}/busy?run=${encodeURIComponent(run)}`,
    favicon: (label, host = "icons.ardia.test") => `http://${host}:${ports.http}/favicon/${label}`,
    icon: (name, host = "icons.ardia.test") => `http://${host}:${ports.http}/icon/${name}.png`,
    gestures: (run = "") => `http://plain.ardia.test:${ports.http}/gestures?run=${encodeURIComponent(run)}`,
    gestureFrame: (run = "") => `http://frame.ardia.test:${ports.http}/gesture-frame?run=${encodeURIComponent(run)}`,
    tint: (kind) => `http://tint.ardia.test:${ports.http}/tint/${kind}`,
    media: (run = "") => `http://media.ardia.test:${ports.http}/media${run ? `?run=${encodeURIComponent(run)}` : ""}`,
  };
  links = url;
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
