import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";

const run = promisify(execFile);
export const ICON_COLOR = [224, 33, 138];
export const PAGE_PREFIX = "/desktop-pages";

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, check]);
}

export function solidPng(size, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

export async function makeClips(dir, { seconds = 8 } = {}) {
  const withAudio = join(dir, "clip.webm");
  const silent = join(dir, "silent.webm");
  const video = ["-f", "lavfi", "-i", `testsrc=size=320x180:rate=15:duration=${seconds}`];
  await run("ffmpeg", ["-loglevel", "error", "-y", ...video, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`, "-c:v", "libvpx", "-b:v", "200k", "-c:a", "libopus", "-shortest", withAudio], { timeout: 60000 });
  await run("ffmpeg", ["-loglevel", "error", "-y", ...video, "-an", "-c:v", "libvpx", "-b:v", "200k", silent], { timeout: 60000 });
  return { withAudio: await readFile(withAudio), silent: await readFile(silent) };
}

const AUTO_PIP_HANDLER = `window.pipLog = []; navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => { pipLog.push("enter"); try { await document.getElementById("video").requestPictureInPicture(); pipLog.push("opened"); } catch (error) { pipLog.push(String(error)); } });`;
const OUTSIDE_SESSION = `window.popupResult = null; setTimeout(() => { popupResult = !!window.open("about:blank", "_blank"); }, 6000);`;
const MEDIA_REQUESTS = `window.mediaLog = []; document.getElementById("camera").addEventListener("click", () => { navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => { mediaLog.push("granted:" + stream.getTracks().map((t) => t.kind).sort().join("+")); stream.getTracks().forEach((t) => t.stop()); }, (error) => mediaLog.push("denied:" + error.name)); }); document.getElementById("screen").addEventListener("click", () => { navigator.mediaDevices.getDisplayMedia({ video: true }).then((stream) => { window.shared = stream; mediaLog.push("sharing:" + stream.getVideoTracks().length); stream.getVideoTracks()[0].addEventListener("ended", () => mediaLog.push("ended")); }, (error) => mediaLog.push("refused:" + error.name)); });`;
const DROP_TARGET = `window.drops = 0; const target = document.getElementById("target"); target.addEventListener("dragover", (e) => e.preventDefault()); target.addEventListener("drop", (e) => { e.preventDefault(); drops++; });`;
const HUGE = "position:absolute;left:600px;top:24px;font-size:40px;display:block;width:420px;height:80px";

export function registerPages(fixtures, clips) {
  const route = (name, handler) => fixtures.route(`${PAGE_PREFIX}/${name}`, handler);
  const media = (body) => ({ send }) => send(200, "video/webm", body, { "content-length": String(body.length) });
  if (clips) {
    route("clip.webm", media(clips.withAudio));
    route("silent.webm", media(clips.silent));
  }
  route("video", ({ html, url }) => html("Desktop video", `<h1>Desktop video</h1><video id="video" src="${PAGE_PREFIX}/clip.webm" loop controls width="640" height="360" style="margin-left:min(600px, 30vw)"></video>${url.searchParams.get("register") ? `<script>${AUTO_PIP_HANDLER}</script>` : ""}`));
  route("outside-session", ({ html }) => html("Videos outside the media session", `<h1>Videos outside the media session</h1><video id="skipped" src="${PAGE_PREFIX}/silent.webm" muted loop autoplay playsinline disablepictureinpicture width="800" height="450"></video><video id="big" src="${PAGE_PREFIX}/silent.webm" muted loop autoplay playsinline width="480" height="270"></video><video id="small" src="${PAGE_PREFIX}/silent.webm" muted loop autoplay playsinline width="160" height="90"></video><script>${OUTSIDE_SESSION}</script>`));
  route("media-requests", ({ html }) => html("Media requests", `<h1>Media requests</h1><button id="camera" style="font-size:32px;margin:24px 24px 24px 600px">Use camera and microphone</button><button id="screen" style="font-size:32px;margin:24px 24px 24px 600px">Share screen</button><script>${MEDIA_REQUESTS}</script>`));
  route("links", ({ html, url }) => {
    const target = (url.searchParams.get("to") ?? "").replace(/"/g, "&quot;");
    const title = url.searchParams.get("title") ?? "Desktop links";
    const popup = url.searchParams.get("popup");
    const wait = Math.max(0, Math.min(20000, Number(url.searchParams.get("popupDelay") ?? 0) | 0));
    const opener = popup ? `<script>${wait ? `setTimeout(() => window.open(${JSON.stringify(popup)}), ${wait})` : `window.open(${JSON.stringify(popup)})`}</script>` : "";
    const background = /^[0-9a-f]{6}$/i.test(url.searchParams.get("bg") ?? "") ? `<style>body{background:#${url.searchParams.get("bg")}}</style>` : "";
    const top = Math.max(0, Math.min(2000, Number(url.searchParams.get("top") ?? 24) | 0));
    return html(title, `${background}${opener}<a id="link" href="${target}" style="${HUGE.replace("top:24px", `top:${top}px`)}">Desktop link</a><p id="words" style="position:absolute;left:600px;top:200px;font-size:28px;margin:0">Ardia selects this whole quoted sentence.</p><div id="target" style="position:absolute;left:600px;top:320px;width:500px;height:240px;background:#ddeeff">Drop target</div><div id="tall" style="height:5000px"></div><script>${DROP_TARGET}</script>`);
  });
  route("fullscreen-button", ({ html }) => html("Fullscreen button", `<h1>Fullscreen button</h1><button id="enter" style="font-size:32px;margin:24px 24px 24px 600px" onclick="document.documentElement.requestFullscreen()">Enter fullscreen</button>`));
  route("pane", ({ html, url }) => {
    const label = (url.searchParams.get("label") ?? "pane").replace(/[^A-Za-z0-9_-]/g, "");
    return html(`Pane ${label}`, `<h1>Pane ${label}</h1>${Array.from({ length: 5 }, (_, i) => `<p>Paragraph ${i + 1} holds the word needle once.</p>`).join("")}<img id="image" src="${PAGE_PREFIX}/icon.png" width="32" height="32">`);
  });
  route("icon.png", ({ send }) => send(200, "image/png", solidPng(32, ICON_COLOR)));
  route("icon", ({ html }) => html("Magenta icon", "<h1>Magenta icon</h1>", `<link rel="icon" href="${PAGE_PREFIX}/icon.png">`));
  const page = (name, query = "") => `${PAGE_PREFIX}/${name}${query}`;
  return {
    http: (name, query) => fixtures.url.http("pages.ardia.test", page(name, query)),
    https: (name, query, host = "secure.ardia.test") => fixtures.url.https(host, page(name, query)),
  };
}
