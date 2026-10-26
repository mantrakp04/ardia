#!/usr/bin/env node
const HELP = `Video upscaling (Settings › Tabs › Video upscaling) end to end, in a hidden instance: what the GPU process upscales
in every state the gate decides, read from its trace events (ArdiaVSR.* in the "gpu" category) and the engine's gate.

  node apps/browser/scripts/video-upscaling-test.mjs <Debug app> [--out DIR] [--keep] [--attach] [--seconds N] [check…]
  node apps/browser/scripts/video-upscaling-test.mjs --list

  --out DIR     scratch: clips, the instance's data, the log (default $TMPDIR/ac-video-upscaling)
  --keep        leave the instance up; --attach reuses it (seconds instead of a launch)
  --seconds N   how long each check watches (default 4)

Needs ffmpeg (the clips are made once into DIR/media). Each check prints PASS/FAIL with what the GPU did: jobs (new
frames upscaled, with their median wall and GPU ms), cache hits (redraws that reused an output), setups and the gate.`;
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { attach, launch, session, sleep } from "../../../scripts/lib/instance.mjs";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, keep: { type: "boolean" }, attach: { type: "boolean" }, seconds: { type: "string" }, list: { type: "boolean" }, help: { type: "boolean", short: "h" } },
});
const CHECKS = {
  "on-480": "854×480 H.264 in a 1280×720 box: VideoToolbox super resolution, then MetalFX to the box",
  "on-360": "640×360 H.264 in a 1280×720 box",
  "on-720": "1280×720 H.264 in a 1600×900 box: VideoToolbox ×1.5, then MetalFX",
  "on-1080": "1920×1080 H.264 in a 1600×900 box on a 2x screen: MetalFX only",
  "mse-720": "the 720p clip through Media Source Extensions",
  "vp9-480": "854×480 VP9 (WebM)",
  "crop-cover": "854×480 with object-fit: cover in a square box (a cropped source region)",
  paused: "a paused video: redraws reuse the output, no new jobs",
  native: "a video drawn at its own size: nothing",
  "setting-off": "Video upscaling off in Settings: nothing",
  "background-tab": "playing in a background tab: nothing",
  "app-inactive": "the app not active: nothing",
  occluded: "the window occluded: nothing",
  "low-power": "Low Power Mode (acted): nothing",
  thermal: "serious thermal pressure (acted): nothing",
  pip: "the video in Picture in Picture: nothing",
  "hdr-pq": "an HDR10 (PQ) clip: declined",
  "hdr-hlg": "an HLG clip: declined",
  fullscreen: "page full screen (acted): upscaled to the screen",
  "little-ardia": "a Little Ardia window: nothing",
  teardown: "the gate closing frees the scaler, its session and buffers within a few seconds",
  "idle-teardown": "a paused video that stops presenting still frees everything after 3 s, with no new frame",
  "idle-quiet": "once freed, a page that keeps drawing (no video, or the gate closed) never wakes the idle timer again",
};
if (flags.help) {
  console.log(HELP);
  process.exit(0);
}
if (flags.list) {
  for (const [name, what] of Object.entries(CHECKS)) console.log(`${name.padEnd(16)} ${what}`);
  process.exit(0);
}
if (!positionals[0] && !flags.attach) {
  console.error(HELP);
  process.exit(2);
}
const app = positionals[0] && positionals[0].endsWith(".app") ? resolve(positionals.shift()) : null;
const wanted = positionals.length ? positionals : Object.keys(CHECKS);
const out = resolve(flags.out ?? join(tmpdir(), "ac-video-upscaling"));
const media = join(out, "media");
const data = join(out, "data");
const seconds = Number(flags.seconds ?? 4);
mkdirSync(media, { recursive: true });

function makeClips() {
  const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: "inherit" });
  const master = join(media, "master.mp4");
  const tags = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];
  if (!existsSync(master))
    ff("-f", "lavfi", "-i", "mandelbrot=s=1920x1080:r=30:maxiter=128:start_scale=2:end_scale=0.2", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30",
      "-filter_complex", "[0][1]overlay=x='100+200*sin(t/3)':y=80,format=yuv420p", "-t", "8", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", ...tags, master);
  for (const size of ["640x360", "854x480", "1280x720", "1920x1080"]) {
    const f = join(media, `clip_${size}.mp4`);
    if (!existsSync(f))
      ff("-i", master, "-vf", `scale=${size}:flags=area,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", ...tags,
        "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1", "-movflags", "+faststart", f);
  }
  const frag = join(media, "clip_1280x720_frag.mp4");
  if (!existsSync(frag)) ff("-i", join(media, "clip_1280x720.mp4"), "-c", "copy", "-movflags", "frag_keyframe+empty_moov+default_base_moof", frag);
  const vp9 = join(media, "clip_854x480.webm");
  if (!existsSync(vp9)) ff("-i", join(media, "clip_854x480.mp4"), "-c:v", "libvpx-vp9", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8", vp9);
  for (const [name, transfer, extra] of [["pq", "smpte2084", ":hdr10=1:max-cll=1000,400"], ["hlg", "arib-std-b67", ""]]) {
    const f = join(media, `clip_720_${name}.mp4`);
    if (!existsSync(f))
      ff("-i", join(media, "clip_1280x720.mp4"), "-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast",
        "-x265-params", `colorprim=bt2020:transfer=${transfer}:colormatrix=bt2020nc${extra}`, "-tag:v", "hvc1", f);
  }
  writeFileSync(join(media, "index.html"), `<!doctype html><html><head><title>Video</title><style>html,body{margin:0;background:#000}video{display:block}</style></head><body>
<video id="v" muted loop playsinline></video>
<script>
const q = new URLSearchParams(location.search);
const v = document.getElementById("v");
v.style.width = (q.get("w") || "1280") + "px";
v.style.height = (q.get("h") || "720") + "px";
v.style.objectFit = q.get("fit") || "contain";
const src = q.get("src") || "clip_854x480.mp4";
window.frames_ = 0;
const tick = () => { window.frames_++; v.requestVideoFrameCallback(tick); };
v.requestVideoFrameCallback(tick);
async function mse() {
  const ms = new MediaSource();
  v.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
  const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.64001f"');
  sb.appendBuffer(await (await fetch(src)).arrayBuffer());
  await new Promise((r) => sb.addEventListener("updateend", r, { once: true }));
  ms.endOfStream();
}
window.ready = (q.get("mse") ? mse() : Promise.resolve(v.src = src)).then(() => v.play()).then(() => "ok", (e) => String(e));
</script></body></html>`);
}

function serve() {
  const types = { ".mp4": "video/mp4", ".webm": "video/webm", ".html": "text/html" };
  const server = createServer((req, res) => {
    const path = join(media, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(media) || !existsSync(path)) return res.writeHead(404).end();
    const size = statSync(path).size;
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const headers = { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
    if (range) {
      const start = +range[1];
      const end = range[2] ? +range[2] : size - 1;
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      createReadStream(path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
      createReadStream(path).pipe(res);
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

makeClips();
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;

let instance;
if (flags.attach) instance = attach(data);
else {
  instance = await launch(app, {
    data, fresh: true, onboarded: true,
    session: session({ tabs: [{ id: "home", url: "about:blank", title: "Home" }] }),
    ready: "return !!globalThis.expo?.modules?.ArdiaEngine && Object.keys(ac.store.getState().windows).length > 0",
  });
}
const evalApp = (body, timeout) => instance.eval(body, { timeout });
const engine = (name, args = {}) => evalApp(`return ac.engine.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
const store = () => evalApp(`const s = ac.store.getState(); const w = Object.values(s.windows).find((w) => w.kind !== "small"); return { windowId: w.id, active: w.activeTabIds[w.profileId], tabs: w.tabIds.map((id) => ({ id, url: s.tabs[id]?.url })) }`);
const until = async (what, test, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
    const v = await test().catch(() => null);
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
};
const main = await store();
const windowNumber = (tabId) => engine("tabs.devWindowNumber", { tabId });
const win = async (tabId, action) => engine("windows.dev", { window: await windowNumber(tabId), action });

await win(main.tabs[0].id, "fakeOcclusion:visible");

async function openVideo(query, windowId = main.windowId) {
  const url = `${base}/index.html?${query}&n=${Date.now()}`;
  const id = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(windowId)}, { url: ${JSON.stringify(url)} })`);
  await evalApp(`ac.actions.switchToTab(${JSON.stringify(id)}); return true`);
  const page = await until(`the page ${query}`, () => instance.page(url, { timeout: 2000 }));
  await until("the page's script", async () => (await page.eval("typeof window.ready")) === "object");
  const ready = await page.eval("window.ready", { timeout: 15000 });
  if (ready !== "ok") throw new Error(`the video didn't play: ${ready}`);
  await until("frames", async () => (await page.eval("window.frames_")) > 10);
  return { id, page, url };
}
const closeTab = (id) => evalApp(`ac.store.getState().closeTab(${JSON.stringify(id)}); return true`);
const gate = async (v) => {
  const state = await engine("webView.videoUpscalingState");
  const tab = state?.tabs?.find((t) => t.url === v.url) ?? null;
  return { allowed: tab?.allowed ?? null, state };
};

async function watch(ms = seconds * 1000, during) {
  const browser = await instance.browser();
  const events = [];
  browser.on("Tracing.dataCollected", (p) => events.push(...p.value.filter((e) => String(e.name).startsWith("ArdiaVSR"))));
  const done = new Promise((r) => browser.on("Tracing.tracingComplete", r));
  await browser.send("Tracing.start", { traceConfig: { includedCategories: ["gpu"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
  const extra = during ? await during() : null;
  await sleep(ms);
  await browser.send("Tracing.end");
  await Promise.race([done, sleep(10000)]);
  browser.close();
  const named = (n) => events.filter((e) => e.name === `ArdiaVSR.${n}`);
  const jobs = named("Job");
  const median = (xs) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  return {
    jobs: jobs.length,
    ok: jobs.filter((e) => e.args?.ok).length,
    ms: median(jobs.map((e) => e.args?.ms)),
    gpuMs: median(jobs.map((e) => e.args?.gpu_ms)),
    doneMs: median(jobs.map((e) => e.args?.completed_ms)),
    encodeMs: median(jobs.map((e) => e.args?.encode_ms)),
    factor: jobs.at(-1)?.args?.factor ?? null,
    source: jobs.at(-1)?.args?.source ?? null,
    target: jobs.at(-1)?.args?.target ?? null,
    hits: named("CacheHit").length,
    setups: named("SetupDone").map((e) => `${e.args?.ok ? "ok" : "failed"} ${Math.round(e.args?.ms ?? 0)} ms`),
    misses: named("Miss").length,
    late: named("LateSwap").length,
    teardowns: named("TearDown").length,
    wakes: named("IdleWake").length,
    extra,
  };
}
const fmt = (w) => `jobs ${w.ok}/${w.jobs}${w.ms !== null ? ` (median ${w.ms.toFixed(2)} ms: encode ${w.encodeMs?.toFixed(2)}, done ${w.doneMs?.toFixed(2)}, GPU ${w.gpuMs?.toFixed(2)} ms; ×${w.factor}, ${w.source} → ${w.target})` : ""}, hits ${w.hits}, late swaps ${w.late}, misses ${w.misses}${w.setups.length ? `, setups ${w.setups.join("; ")}` : ""}`;

const results = [];
async function check(name, body) {
  if (!wanted.includes(name)) return;
  const started = Date.now();
  try {
    const detail = await body();
    results.push([name, true]);
    console.log(`PASS ${name} (${Date.now() - started} ms) ${detail}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`FAIL ${name} (${Date.now() - started} ms) ${e.message}`);
  }
}
const expectWork = (w, g) => {
  if (!g.allowed) throw new Error(`the gate is closed: ${JSON.stringify(g.state)}`);
  if (w.ok < 2) throw new Error(`no upscaled frames: ${fmt(w)}`);
  return `${fmt(w)}`;
};
const expectNothing = (w, g) => {
  if (g.allowed) throw new Error("the gate is open");
  if (w.jobs || w.hits || w.setups.length) throw new Error(`work done: ${fmt(w)}`);
  return `gate closed, ${fmt(w)}`;
};
async function warm(query) {
  const v = await openVideo(query);
  await watch(2500);
  return v;
}
async function playing(name, query, expectFactor) {
  await check(name, async () => {
    const v = await warm(query);
    try {
      const w = await watch();
      const g = await gate(v);
      const r = expectWork(w, g);
      if (expectFactor !== undefined && w.factor !== expectFactor) throw new Error(`expected ×${expectFactor}: ${r}`);
      return r;
    } finally {
      await closeTab(v.id);
    }
  });
}

await engine("webView.setVideoUpscaling", { enabled: true });
await playing("on-480", "src=clip_854x480.mp4&w=1280&h=720", 2);
await playing("on-360", "src=clip_640x360.mp4&w=1280&h=720", 2);
await playing("on-720", "src=clip_1280x720.mp4&w=1600&h=900", 1.5);
await playing("on-1080", "src=clip_1920x1080.mp4&w=1600&h=900", 0);
await playing("mse-720", "src=clip_1280x720_frag.mp4&mse=1&w=1600&h=900");
await playing("vp9-480", "src=clip_854x480.webm&w=1280&h=720");
await playing("crop-cover", "src=clip_854x480.mp4&w=900&h=900&fit=cover");

await check("paused", async () => {
  const v = await warm("src=clip_854x480.mp4&w=1280&h=720");
  try {
    await v.page.eval("document.getElementById('v').pause(), true");
    await sleep(1000);
    const w = await watch(seconds * 1000, async () => {
      for (let i = 0; i < 10; i++) await v.page.eval("window.scrollBy(0, 1), window.scrollBy(0, -1), true");
    });
    if (w.jobs) throw new Error(`a paused video was processed again: ${fmt(w)}`);
    if (!(await gate(v)).allowed) throw new Error("the gate is closed");
    return `gate open, ${fmt(w)}`;
  } finally {
    await closeTab(v.id);
  }
});

await check("native", async () => {
  const dpr = await instance.page("about:blank", { timeout: 3000 }).then((p) => p.eval("devicePixelRatio")).catch(() => 2);
  const v = await warm(`src=clip_854x480.mp4&w=${854 / dpr}&h=${480 / dpr}`);
  try {
    const w = await watch();
    if (w.jobs || w.setups.length) throw new Error(`work at native size: ${fmt(w)}`);
    if (!(await gate(v)).allowed) throw new Error("the gate is closed");
    return `devicePixelRatio ${dpr}, gate open, ${fmt(w)}`;
  } finally {
    await closeTab(v.id);
  }
});

async function closedBy(name, query, close, reopen) {
  await check(name, async () => {
    const v = await warm(query);
    try {
      await close(v);
      await sleep(800);
      const w = await watch();
      return expectNothing(w, await gate(v));
    } finally {
      await reopen(v).catch(() => null);
      await closeTab(v.id);
    }
  });
}
const q480 = "src=clip_854x480.mp4&w=1280&h=720";
await closedBy("setting-off", q480, () => evalApp("ac.store.getState().updateSettings({ videoUpscaling: false }); return true"),
  () => evalApp("ac.store.getState().updateSettings({ videoUpscaling: true }); return true"));
await closedBy("background-tab", q480, () => evalApp(`ac.actions.switchToTab("${main.tabs[0].id}"); return true`), async () => {});
await closedBy("app-inactive", q480, (v) => win(v.id, "fakeAppActive:0"), (v) => win(v.id, "fakeAppActive:1"));
await closedBy("occluded", q480, (v) => win(v.id, "fakeOcclusion:occluded"), (v) => win(v.id, "fakeOcclusion:visible"));
await closedBy("low-power", q480, () => engine("webView.setVideoUpscalingTestConditions", { lowPower: true }), () => engine("webView.setVideoUpscalingTestConditions"));
await closedBy("thermal", q480, () => engine("webView.setVideoUpscalingTestConditions", { thermalPressure: true }), () => engine("webView.setVideoUpscalingTestConditions"));

await check("pip", async () => {
  const v = await warm(q480);
  try {
    const r = await v.page.eval("document.getElementById('v').requestPictureInPicture().then(() => 'ok', (e) => String(e))", { userGesture: true });
    if (r !== "ok") throw new Error(`no PiP: ${r}`);
    await sleep(1500);
    const w = await watch();
    if (w.jobs || w.setups.length) throw new Error(`work in PiP: ${fmt(w)}`);
    return `PiP open, ${fmt(w)}`;
  } finally {
    await v.page.eval("document.exitPictureInPicture?.().catch(() => null), true").catch(() => null);
    await closeTab(v.id);
  }
});

for (const [name, clip] of [["hdr-pq", "clip_720_pq.mp4"], ["hdr-hlg", "clip_720_hlg.mp4"]]) {
  await check(name, async () => {
    const v = await warm(`src=${clip}&w=1600&h=900`);
    try {
      const w = await watch();
      if (w.jobs || w.setups.length) throw new Error(`HDR was processed: ${fmt(w)}`);
      return fmt(w);
    } finally {
      await closeTab(v.id);
    }
  });
}

await check("fullscreen", async () => {
  const v = await warm("src=clip_854x480.mp4&w=640&h=360");
  try {
    const r = await v.page.eval("document.getElementById('v').requestFullscreen().then(() => 'ok', (e) => String(e))", { userGesture: true });
    if (r !== "ok") throw new Error(`no full screen: ${r}`);
    await sleep(2500);
    const w = await watch();
    return expectWork(w, await gate(v));
  } finally {
    await v.page.eval("document.exitFullscreen?.().catch(() => null), true").catch(() => null);
    await sleep(1000);
    await closeTab(v.id);
  }
});

await check("little-ardia", async () => {
  const before = await evalApp("return Object.keys(ac.store.getState().windows)");
  await evalApp(`ac.runCommand({ command: "newLittleArdia", arg: null, windowId: null }); return true`);
  const small = await until("a Little Ardia window", () => evalApp(`const s = ac.store.getState(); return Object.values(s.windows).find((w) => w.kind === "small" && !${JSON.stringify(before)}.includes(w.id))?.id ?? null`));
  const url = `${base}/index.html?${q480}&n=${Date.now()}`;
  const smallTab = await until("its tab", () => evalApp(`return ac.store.getState().windows[${JSON.stringify(small)}]?.tabIds?.[0] ?? null`));
  await evalApp(`ac.store.getState().navigate(${JSON.stringify(smallTab)}, ${JSON.stringify(url)}, { userInitiated: true }); return true`);
  const page = await until("its page", () => instance.page(url, { timeout: 2000 }));
  await until("the page's script", async () => (await page.eval("typeof window.ready")) === "object");
  if ((await page.eval("window.ready", { timeout: 15000 })) !== "ok") throw new Error("the video didn't play");
  await until("its browser", () => evalApp(`return !!ac.pageState.getState().ready[${JSON.stringify(smallTab)}]`));
  await win(smallTab, "fakeOcclusion:visible");
  await sleep(2000);
  const g = await gate({ url });
  if (!g.state.windows.some((w) => w.littleArdia && w.key && w.occlusionVisible)) throw new Error(`Little Ardia isn't the focused, visible window: ${JSON.stringify(g.state.windows)}`);
  if (g.allowed) throw new Error("the gate is open in Little Ardia");
  const w = await watch();
  await evalApp(`ac.store.getState().closeWindow?.(${JSON.stringify(small)}); return true`).catch(() => null);
  if (w.jobs || w.setups.length) throw new Error(`work in Little Ardia: ${fmt(w)}`);
  return fmt(w);
});

await check("teardown", async () => {
  const v = await warm(q480);
  try {
    const w = await watch(5000, () => evalApp("ac.store.getState().updateSettings({ videoUpscaling: false }); return true"));
    if (w.teardowns < 1) throw new Error(`nothing was freed: ${fmt(w)}`);
    return `freed ${w.teardowns}×, ${fmt(w)}`;
  } finally {
    await evalApp("ac.store.getState().updateSettings({ videoUpscaling: true }); return true");
    await closeTab(v.id);
  }
});

await check("idle-teardown", async () => {
  const v = await warm(q480);
  try {
    await v.page.eval("document.getElementById('v').pause(), true");
    const w = await watch(5500);
    if (w.teardowns < 1) throw new Error(`nothing was freed without a new frame: ${fmt(w)}`);
    if (w.jobs) throw new Error(`a paused video was processed: ${fmt(w)}`);
    return `freed ${w.teardowns}×, ${fmt(w)}`;
  } finally {
    await closeTab(v.id);
  }
});

const animate = (page) => page.eval(`(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:0;top:0;width:40px;height:40px;background:red"; d.animate([{ transform: "translateX(0)" }, { transform: "translateX(300px)" }], { duration: 1000, iterations: Infinity }); document.body.append(d); return true })()`);
await check("idle-quiet", async () => {
  const results = [];
  const v = await warm(`${q480}&nosrc=1`);
  try {
    await v.page.eval("(() => { const e = document.getElementById('v'); e.pause(); e.removeAttribute('src'); e.load(); return true })()");
    await animate(v.page);
    const w = await watch(11000);
    results.push(`video removed: wakes ${w.wakes}, teardowns ${w.teardowns}`);
    if (w.wakes !== w.teardowns || w.wakes > 1) throw new Error(`the idle timer woke ${w.wakes}× for ${w.teardowns} teardowns: ${fmt(w)}`);
  } finally {
    await closeTab(v.id);
  }
  const v2 = await warm(q480);
  try {
    await animate(v2.page);
    const w = await watch(11000, () => evalApp("ac.store.getState().updateSettings({ videoUpscaling: false }); return true"));
    results.push(`gate closed after a video: wakes ${w.wakes}, teardowns ${w.teardowns}`);
    if (w.teardowns !== 1 || w.wakes !== 1) throw new Error(`expected one teardown and one wake in 11 s: ${fmt(w)}, wakes ${w.wakes}`);
  } finally {
    await evalApp("ac.store.getState().updateSettings({ videoUpscaling: true }); return true");
    await closeTab(v2.id);
  }
  return results.join("; ");
});

server.close();
if (!flags.keep && !flags.attach) await instance.quit();
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.join(", ")}` : ""}${flags.keep ? `; instance kept in ${data}` : ""}`);
process.exit(failed.length ? 1 : 0);
