#!/usr/bin/env node
const HELP = `Captures the hero meadow's first WebGL frame as WebP posters.

  node scripts/hero-posters.mjs [--url http://127.0.0.1:4321/] [--chrome <path>] [--keep <dir>]

Run it against \`pnpm dev\` (it imports the legibility module from the dev server). It opens headless Chrome
on the real GPU (Metal), reads the canvas at its first frame (dawn, wind at rest, no brush), and works out
the text tones the scene picks for that frame. It writes the sized WebPs and posters.json to
src/assets/hero/. --keep saves the lossless captures there too.`;

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { HERO_FRAMES, HERO_STATES } from "../src/data/heroFrames.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const out = join(site, "src/assets/hero");

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const url = option("--url", "http://127.0.0.1:4321/");
const chrome = option("--chrome", process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const keep = option("--keep", null);
const port = Number(option("--port", "9471"));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const USER_AGENTS = { mac: MAC_UA, phone: PHONE_UA };
const FRAMES = HERO_FRAMES.map(({ name, capture }) => ({ frame: name, ...capture, ua: USER_AGENTS[capture.device], mobile: capture.device === "phone" }));
const QUALITY_CEILING = 70;
const QUALITY_FLOOR = 40;
const STATES = HERO_STATES.map(({ name, reducedMotion }) => ({ state: name, reducedMotion }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const inject = `(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attributes) {
    return getContext.call(this, type, type === "webgl2" ? { ...attributes, preserveDrawingBuffer: true } : attributes);
  };
  const state = (window.__poster = { first: null, probe: null });
  const getBufferSubData = WebGL2RenderingContext.prototype.getBufferSubData;
  WebGL2RenderingContext.prototype.getBufferSubData = function (target, offset, destination, ...rest) {
    const result = getBufferSubData.call(this, target, offset, destination, ...rest);
    if (!state.probe && state.first) state.probe = Array.from(destination);
    return result;
  };
  new MutationObserver(() => {
    const canvas = document.querySelector("[data-meadow-canvas]");
    if (state.first || !canvas || canvas.dataset.meadow !== "ready") return;
    const box = canvas.getBoundingClientRect();
    state.first = { png: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, top: box.top + scrollY };
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-meadow"] });
})();`;

const decideTones = `(async () => {
  const { TextTones } = await import("/src/scripts/meadow/legibility.ts");
  const hero = document.querySelector("[data-meadow]");
  const first = window.__poster.first;
  const pixels = Uint8Array.from(window.__poster.probe);
  const probeHeight = pixels.length / 4 / 96;
  let header = "light";
  const tones = new TextTones(hero, document.querySelector("[data-bar]"), (tone) => { header = tone; });
  tones.measure(first.top);
  tones.decide(pixels, 96, probeHeight, first.cssWidth, first.cssHeight);
  const groups = {};
  for (const group of tones.groups) {
    if (!group.boxes.length) continue;
    groups[group.name] = { tone: group.tone, halo: Math.round(tones.haloFor(group) / 0.05) * 0.05 };
  }
  const headerGroup = tones.header;
  const headerHalo = Math.round(tones.haloFor(headerGroup) / 0.05) * 0.05;
  tones.reset();
  return JSON.stringify({ groups, sky: header, headerHalo, heroHeight: hero.offsetHeight, coarse: matchMedia("(pointer: coarse)").matches, device: document.documentElement.dataset.device });
})()`;

async function launch() {
  const profile = mkdtempSync("/tmp/hero-posters-");
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--use-angle=metal",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "--window-size=2600,1400",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let endpoint = null;
  for (let i = 0; i < 150 && !endpoint; i++) {
    await sleep(100);
    endpoint = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((res) => res.json())
      .then((json) => json.webSocketDebuggerUrl)
      .catch(() => null);
  }
  if (!endpoint) throw new Error("Chrome didn't open its debugging port");
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const close = async () => {
    await send("Browser.close").catch(() => {});
    await sleep(300);
    proc.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  };
  return { send, close };
}

async function capture(browser, frame, state) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: frame.width,
    height: frame.height,
    deviceScaleFactor: frame.dpr,
    mobile: !!frame.mobile,
    screenWidth: frame.width,
    screenHeight: frame.height,
  });
  if (frame.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setUserAgentOverride", { userAgent: frame.ua });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: state.reducedMotion ? "reduce" : "no-preference" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: inject });
  await send("Page.navigate", { url });
  const deadline = Date.now() + 60000;
  while (!(await evaluate("!!(window.__poster && window.__poster.first && window.__poster.probe)"))) {
    if (Date.now() > deadline) throw new Error(`no first frame for ${state.state}-${frame.frame}`);
    await sleep(100);
  }
  const first = await evaluate("({ ...window.__poster.first, png: null, pngLength: window.__poster.first.png.length })");
  const chunks = [];
  for (let at = 0; at < first.pngLength; at += 512 * 1024) chunks.push(await evaluate(`window.__poster.first.png.slice(${at}, ${at + 512 * 1024})`));
  first.png = chunks.join("");
  const tones = JSON.parse(await evaluate(decideTones));
  await browser.send("Target.closeTarget", { targetId });
  return { first, tones };
}

async function webp(png, width, height, sourceWidth, quality) {
  const pipeline = width === sourceWidth ? sharp(png) : sharp(png).resize(width, height, { kernel: "lanczos3" });
  return pipeline.webp({ quality, smartSubsample: true, effort: 6 }).toBuffer();
}

async function encode(png, frame, name) {
  const { width, height } = await sharp(png).metadata();
  const fit = async (largest) => {
    let low = QUALITY_FLOOR;
    let high = QUALITY_CEILING;
    while (low < high) {
      const quality = Math.ceil((low + high) / 2);
      const bytes = (await webp(png, largest, Math.round((height * largest) / width), width, quality)).length;
      if (bytes <= frame.budget) low = quality;
      else high = quality - 1;
    }
    const bytes = (await webp(png, largest, Math.round((height * largest) / width), width, low)).length;
    return { quality: low, fits: bytes <= frame.budget };
  };
  let largest = Math.min(width, Math.max(...frame.widths.map((w) => w || width)));
  let { quality: low, fits } = await fit(largest);
  while (!fits) {
    largest = Math.round(largest * 0.92);
    ({ quality: low, fits } = await fit(largest));
  }
  const widths = [...new Set(frame.widths.map((w) => Math.min(largest, w || width)))];
  const files = [];
  for (const w of widths) {
    const h = Math.round((height * w) / width);
    const buffer = await webp(png, w, h, width, low);
    const file = `${name}-${w}.webp`;
    writeFileSync(join(out, file), buffer);
    files.push({ file, width: w, height: h, quality: low, bytes: buffer.length });
  }
  const lqip = await sharp(png)
    .resize(24, Math.max(4, Math.round((24 * height) / width)), { kernel: "lanczos3" })
    .webp({ quality: 50, smartSubsample: true, effort: 6 })
    .toBuffer();
  return { files, width, height, lqip: `data:image/webp;base64,${lqip.toString("base64")}` };
}

mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) if (name.endsWith(".webp")) unlinkSync(join(out, name));
if (keep) mkdirSync(keep, { recursive: true });

const browser = await launch();
const posters = [];
try {
  for (const state of STATES) {
    for (const frame of FRAMES) {
      const { first, tones } = await capture(browser, frame, state);
      const png = Buffer.from(first.png.split(",")[1], "base64");
      const name = `${state.state}-${frame.frame}`;
      if (keep) writeFileSync(join(keep, `${name}.png`), png);
      const encoded = await encode(png, frame, name);
      posters.push({
        state: state.state,
        frame: frame.frame,
        viewport: [frame.width, frame.height],
        heroHeight: tones.heroHeight,
        width: encoded.width,
        height: encoded.height,
        files: encoded.files,
        lqip: encoded.lqip,
        tones: tones.groups,
        sky: tones.sky,
        headerHalo: tones.headerHalo,
      });
      console.log(`${name}: ${encoded.width}×${encoded.height}, ${encoded.files.map((f) => `${f.width}w q${f.quality} ${(f.bytes / 1024).toFixed(1)} KB`).join(", ")}, tones ${JSON.stringify(tones.groups)} sky ${tones.sky} (device ${tones.device}, coarse ${tones.coarse}, hero ${tones.heroHeight}px)`);
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "posters.json"), `${JSON.stringify(posters, null, 2)}\n`);
