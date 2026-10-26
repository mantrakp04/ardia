#!/usr/bin/env node
// Scroll smoothness: does content that follows the scroll (scroll events, rAF, JS headers and parallax, canvas, scroll-
// driven animations, a smooth-scroll library, inner scrollers) keep up with the compositor on a 120 Hz display? Local
// pages, real event paths, Chrome's own trace, apps run one after another in the same process (rounds alternate order).
//
//   node apps/browser/scripts/perf/scroll-frames.mjs --out <dir> --arm <label>=<app>[,K=V...] [--arm ...] [options]
//
//     --arm <label>=<app>[,K=V][,battery]
//                        repeatable: an app and extra environment for it (ARDIA_SWITCHES=…, ...); battery
//                        turns Chrome's Battery Saver on, as Ardia does on battery or in Low Power Mode, and needs a copy
//                        with the bench channel (native-bench.mjs --only prepare)
//     --reps <n>         gestures per case (default 3)
//     --rounds <n>       default 1; odd rounds run the arms in reverse order
//     --cases <a,b>      case ids or page names (default all; --list prints them)
//     --port <n>         CDP port (default 9561); --page-port <n> (default 9571)
//     --list             print the cases and exit
//
// Input: trackpad, fingers and wheel gestures are CGEvent scroll-wheel events posted to the instance's pid and window
// (acperf postscroll: phases, then momentum events, at 120 events/s unless the case says 90 or 60; wheel is 12 notches
// 90 ms apart), so they take AppKit's and Chrome's own path (RenderWidgetHostViewMac, the renderer's
// InputHandlerProxy);
// track/hold presses the mouse on a scroller's scrollbar track below its thumb for 3 s without moving it (acperf
// postmouse), so the scrollbar pages on with no further input events. panes has two panes kept in step by a scroll
// handler that also dirties layout, so each frame has two scroll events with layout dirty between them. keys are CDP key events (3 Page Down, then a held Down arrow; a hidden instance's page never has the key window's
// focus for posted keys), so they skip AppKit: Battery Saver's input hold, which watches NSEvents, doesn't see them.
// Each gesture starts from the top, 1.5 s after the last.
// idle is no input for 3 s on a page that draws in rAF (what a video or an idle animation costs).
// Per gesture, from its first event to the last scroll event: from the trace, the renderer's compositor draws
// (ProxyImpl::ScheduledActionDraw: drawHz, drawsLate = gaps over 1.5 refresh intervals), its main frames
// (ProxyMain::BeginMainFrame: mainHz) and stale draws (stalePct: draws with no main-frame activation since the one
// before, so whatever script or rAF placed shows the old scroll position for that frame), the renderer main thread's
// busy time (mainBusyMs) and the part of it in Ardia's page script (pageScriptMs, ardia://page-script) and in extension
// scripts (extensionMs, uBlock Origin's); from the page, rAF rate and gaps over 12.5 ms, and scroll events per second.
// A 60 Hz display makes every row 60; the display row says which. --cpu-throttle <n> slows the page's renderer n times
// (Emulation.setCPUThrottlingRate), so per-frame script costs show as they would on a slower Mac.
// Writes <out>/results.json and prints a table of medians per case and arm. Run it on a quiet Mac, screen unlocked.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { devtools, launch, sleep } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({
  options: {
    out: { type: "string" },
    arm: { type: "string", multiple: true, default: [] },
    reps: { type: "string", default: "3" },
    rounds: { type: "string", default: "1" },
    cases: { type: "string" },
    "cpu-throttle": { type: "string", default: "1" },
    port: { type: "string", default: "9561" },
    "page-port": { type: "string", default: "9571" },
    list: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const CASES = [
  { id: "jsticky/idle", page: "jsticky", src: "idle" },
  { id: "article/trackpad", page: "article", src: "trackpad", noRaf: true },
  { id: "article/keys", page: "article", src: "keys", noRaf: true },
  { id: "article/wheel", page: "article", src: "wheel", noRaf: true },
  { id: "jsticky/trackpad", page: "jsticky", src: "trackpad" },
  { id: "jsticky/fingers", page: "jsticky", src: "fingers" },
  { id: "jsticky/keys", page: "jsticky", src: "keys" },
  { id: "jsticky/wheel", page: "jsticky", src: "wheel" },
  { id: "jsticky/trackpad90", page: "jsticky", src: "trackpad", rate: 90 },
  { id: "jsticky/trackpad60", page: "jsticky", src: "trackpad", rate: 60 },
  { id: "themed/trackpad", page: "themed", src: "trackpad", noRaf: true },
  { id: "lenis/trackpad", page: "lenis", src: "trackpad" },
  { id: "reveal/trackpad", page: "reveal", src: "trackpad" },
  { id: "inner/trackpad", page: "inner", src: "trackpad" },
  { id: "nonpassive/trackpad", page: "nonpassive", src: "trackpad" },
  { id: "track/hold", page: "track", src: "trackhold" },
  { id: "panes/trackpad", page: "panes", src: "trackpad" },
];

if (opt.help || (!opt.list && (!opt.out || !opt.arm.length))) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(opt.help ? 0 : 64);
}
if (opt.list) {
  for (const c of CASES) console.log(c.id);
  process.exit(0);
}

const PROBE = `(() => {
  const P = (window.__probe = { raf: [], scroll: [], on: false });
  const scroller = () => document.querySelector("[data-scroller]") || document.scrollingElement;
  const top = () => { const s = scroller(); return s === document.scrollingElement ? scrollY : s.scrollTop; };
  P.start = (withRaf) => { P.raf = []; P.scroll = []; P.on = true; P.y0 = top(); const loop = (t) => { if (!P.on || !withRaf) return; P.raf.push([t, top()]); requestAnimationFrame(loop); }; requestAnimationFrame(loop); };
  P.stop = () => { P.on = false; return { raf: P.raf, scroll: P.scroll, y0: P.y0, y1: top() }; };
  addEventListener("scroll", () => { if (P.on) P.scroll.push([performance.now(), top()]); }, { capture: true, passive: true });
  P.reset = () => { const s = scroller(); if (s === document.scrollingElement) scrollTo(0, 0); else s.scrollTop = 0; if (window.__reset) window.__reset(); };
})();`;
const filler = (n) => Array.from({ length: n }, (_, i) => `<h2>Section ${i + 1}</h2><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Cras mattis consectetur purus sit amet fermentum. Nullam quis risus eget urna mollis ornare vel eu leo. Vestibulum id ligula porta felis euismod semper.</p><div class=img style="background:linear-gradient(135deg,hsl(${(i * 37) % 360},60%,70%),hsl(${((i * 37) % 360) + 80},60%,50%))"></div><p>Etiam porta sem malesuada magna mollis euismod. Aenean lacinia bibendum nulla sed consectetur. Curabitur blandit tempus porttitor.</p>`).join("");
const head = (title, css = "") => `<!doctype html><meta charset=utf-8><title>${title}</title><style>body{font:17px/1.6 -apple-system,sans-serif;margin:0 auto;max-width:720px;padding:0 24px}.img{height:280px;border-radius:12px;margin:16px 0}${css}</style><script>${PROBE}</script>`;
const PAGES = {
  article: () => head("article") + filler(120),
  themed: () => head("themed").replace("<style>", '<meta name="theme-color" content="#1f6feb"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0d1117"><style>') + filler(120),
  jsticky: () => head("jsticky", "#bar{position:fixed;left:0;right:0;top:0;height:56px;background:#123;color:#fff;display:flex;align-items:center;padding:0 24px;will-change:transform;z-index:5}#par{position:absolute;left:0;right:0;top:0;height:900px;background:repeating-linear-gradient(0deg,#fde 0 40px,#efd 40px 80px);z-index:-1;will-change:transform}#c{position:fixed;right:12px;bottom:12px;width:200px;height:120px;background:#fff;border:1px solid #ccc}#prog{position:fixed;left:0;top:0;height:4px;background:#e33;z-index:6}") +
    `<div id=par></div><div id=bar>JS header <span id=pos></span></div><div id=prog></div><canvas id=c width=400 height=240></canvas><div style=height:80px></div>${filler(120)}` +
    `<script>const bar=document.getElementById("bar"),par=document.getElementById("par"),pos=document.getElementById("pos"),prog=document.getElementById("prog"),cx=document.getElementById("c").getContext("2d");addEventListener("scroll",()=>{const y=scrollY;bar.style.transform="translateY("+Math.max(-56,Math.min(0,-y))+"px)";par.style.transform="translateY("+y*0.5+"px)";pos.textContent=y|0;prog.style.width=(100*y/(document.documentElement.scrollHeight-innerHeight))+"%"});function draw(){const y=scrollY;cx.clearRect(0,0,400,240);for(let i=0;i<24;i++){cx.fillStyle="hsl("+((i*15+y)%360)+",70%,55%)";cx.fillRect(i*17,120+Math.sin((y+i*40)/60)*90,14,14)}requestAnimationFrame(draw)}requestAnimationFrame(draw);</script>`,
  lenis: () => head("lenis") + filler(120) +
    `<script>let target=0,cur=0,running=false;addEventListener("wheel",e=>{e.preventDefault();target=Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,target+e.deltaY));if(!running){running=true;requestAnimationFrame(step)}},{passive:false});function step(){cur+=(target-cur)*0.1;if(Math.abs(target-cur)<0.5)cur=target;scrollTo(0,cur);if(cur!==target)requestAnimationFrame(step);else running=false}window.__reset=()=>{target=cur=0};</script>`,
  reveal: () => head("reveal", ".r{opacity:0;transform:translateY(40px);transition:opacity .4s,transform .4s}.r.in{opacity:1;transform:none}@keyframes grow{from{width:0;background:#e33}to{width:100%;background:#33e}}#sda{position:fixed;top:0;left:0;height:6px;animation:grow linear both;animation-timeline:scroll(root)}@keyframes side{from{left:0}to{left:calc(100% - 40px)}}#sda2{position:fixed;bottom:8px;width:40px;height:40px;border-radius:50%;background:#3a3;animation:side linear both;animation-timeline:scroll(root)}") +
    `<div id=sda></div><div id=sda2></div>` + Array.from({ length: 120 }, (_, i) => `<div class=r><h2>Card ${i + 1}</h2><p>Etiam porta sem malesuada magna mollis euismod. Aenean lacinia bibendum nulla sed consectetur.</p><div class=img style="background:hsl(${(i * 37) % 360},60%,70%)"></div></div>`).join("") +
    `<script>const io=new IntersectionObserver(es=>es.forEach(e=>e.target.classList.toggle("in",e.isIntersecting)),{rootMargin:"0px 0px -10% 0px"});document.querySelectorAll(".r").forEach(e=>io.observe(e));</script>`,
  inner: () => head("inner", "body{max-width:none;padding:0}#s{position:absolute;inset:20px;overflow:auto;border:1px solid #ccc}#s>div{max-width:720px;margin:0 auto}#hdr{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:6px}") +
    `<div id=s data-scroller><div><div id=hdr>Inner <span id=pos></span></div>${filler(120)}</div></div><script>const s=document.getElementById("s"),pos=document.getElementById("pos");s.addEventListener("scroll",()=>{pos.textContent=s.scrollTop|0});</script>`,
  track: () => head("track", "body{max-width:none;padding:0}#s{position:fixed;left:0;top:0;width:50vw;height:100vh;overflow-y:scroll}#s::-webkit-scrollbar{width:16px;background:#eee}#s::-webkit-scrollbar-thumb{background:#888}#s>div{padding:0 24px}") +
    `<div id=s data-scroller><div>${filler(200)}</div></div><canvas id=c width=200 height=100 style="position:fixed;right:12px;bottom:12px"></canvas><script>const cx=c.getContext("2d");function d(){const y=s.scrollTop;cx.clearRect(0,0,200,100);cx.fillStyle="hsl("+(y/4%360)+",70%,50%)";cx.fillRect(0,0,200,100);requestAnimationFrame(d)}requestAnimationFrame(d)</script>`,
  panes: () => head("panes", "body{max-width:none;padding:0}.p{position:fixed;top:0;height:100vh;overflow-y:scroll}#a{left:0;width:60vw}#b{left:60vw;width:40vw}.p>div{padding:0 24px}#mark{height:4px;background:#e33}") +
    `<div id=a class=p data-scroller><div><div id=mark></div>${filler(120)}</div></div><div id=b class=p><div>${filler(120)}</div></div>` +
    `<script>const a=document.getElementById("a"),b=document.getElementById("b"),mark=document.getElementById("mark");a.addEventListener("scroll",()=>{b.scrollTop=a.scrollTop;mark.style.width=(a.scrollTop%100)+"%"});</script>`,
  nonpassive: () => head("nonpassive") + filler(120) + `<script>let n=0;addEventListener("wheel",e=>{n++;if(e.deltaY===12345)e.preventDefault()},{passive:false});</script>`,
};

const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const reps = +opt.reps;
const port = +opt.port;
const pagePort = +opt["page-port"];
const only = opt.cases?.split(",");
const cases = CASES.filter((c) => !only || only.includes(c.id) || only.includes(c.page));
const arms = opt.arm.map((spec) => {
  const [label, rest] = spec.split(/=(.*)/s);
  const [app, ...envs] = rest.split(",");
  return { label, app: resolve(app), battery: envs.includes("battery"), env: Object.fromEntries(envs.filter((e) => e !== "battery").map((e) => e.split(/=(.*)/s).slice(0, 2))) };
});

const toolDir = join(out, ".tools");
function acperfBin() {
  const source = readFileSync(join(here, "acperf.swift"), "utf8");
  const bin = join(toolDir, "acperf");
  if (!existsSync(bin) || !existsSync(`${bin}.src`) || readFileSync(`${bin}.src`, "utf8") !== source) {
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, "acperf.swift"), source);
    execFileSync("swiftc", ["-O", join(toolDir, "acperf.swift"), "-o", bin], { stdio: "inherit" });
    writeFileSync(`${bin}.src`, source);
  }
  return bin;
}

function windowsOf(pid) {
  return JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e",
    `ObjC.import("CoreGraphics"); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)))
     .filter((w) => w.kCGWindowOwnerPID === ${pid} && w.kCGWindowIsOnscreen && w.kCGWindowBounds.Width >= 600).map((w) => ({ id: w.kCGWindowNumber, b: w.kCGWindowBounds })))`], { timeout: 20000 }).toString());
}
function display() {
  const screen = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e",
    `ObjC.import("AppKit"); const s = $.NSScreen.mainScreen; JSON.stringify({ maxHz: s.maximumFramesPerSecond, name: ObjC.unwrap(s.localizedName) })`], { timeout: 20000 }).toString());
  return { ...screen, locked: /"IOConsoleLocked" = Yes/.test(execFileSync("ioreg", ["-n", "Root", "-d1"]).toString()) };
}

async function traceStart(b) {
  await b.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: ["cc", "benchmark", "blink.user_timing", "devtools.timeline", "toplevel", "__metadata"], excludedCategories: ["*"] },
  }, { timeout: 30000 });
}
async function traceStop(b) {
  const done = new Promise((r) => { const off = b.on("Tracing.tracingComplete", (p) => { off(); r(p); }); });
  await b.send("Tracing.end", {}, { timeout: 30000 });
  const { stream } = await done;
  let text = "";
  for (;;) {
    const r = await b.send("IO.read", { handle: stream, size: 1 << 19 }, { timeout: 30000 });
    text += r.base64Encoded ? Buffer.from(r.data, "base64").toString() : r.data;
    if (r.eof) break;
  }
  await b.send("IO.close", { handle: stream });
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : j.traceEvents;
}

async function benchCommand(data, body, timeout = 20000) {
  const id = `sf${Date.now()}`;
  writeFileSync(join(data, "bench-cmd.js"), `// ${id}\n${body}`);
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) {
    try {
      const r = JSON.parse(readFileSync(join(data, "bench-result.json"), "utf8"));
      if (r.id === id) {
        if (r.error) throw new Error(r.error);
        return r.result;
      }
    } catch (e) {
      if (!(e instanceof SyntaxError) && e.code !== "ENOENT") throw e;
    }
  }
  throw new Error("the bench channel never answered: battery arms need a copy from native-bench.mjs --only prepare");
}
const batterySaver = (data, mode) =>
  benchCommand(data, `return globalThis.expo.modules.ArdiaEngine.call("batterySaver", "", ${JSON.stringify(JSON.stringify(mode ? { mode } : {}))}).then(JSON.parse).catch((e) => ({ error: e.message }));`);

async function keys(d) {
  const press = (key, code, autoRepeat, type) => d.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code, autoRepeat });
  for (let i = 0; i < 3; i++) {
    await press("PageDown", 34, false, "rawKeyDown");
    await press("PageDown", 34, false, "keyUp");
    await sleep(300);
  }
  for (let i = 0; i < 16; i++) {
    await press("ArrowDown", 40, i > 0, "rawKeyDown");
    await sleep(40);
  }
  await press("ArrowDown", 40, false, "keyUp");
}

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => { const s = sorted(xs.filter((x) => x !== null && Number.isFinite(x))); return s.length ? s[s.length >> 1] : null; };
const gaps = (ts) => ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g < 100);
const rate = (ts) => (ts.length > 1 ? +((1000 * (ts.length - 1)) / (ts.at(-1) - ts[0])).toFixed(1) : null);

function analyse(events, rep, refreshMs) {
  const mark = events.find((e) => e.name === rep.mark);
  if (!mark) return { error: "the start mark is missing from the trace" };
  const offset = mark.ts / 1000 - rep.now0;
  let last = rep.idle ? rep.now0 + 3000 : Math.max(rep.now0 + 50, ...rep.res.scroll.map((s) => s[0]));
  if (!rep.idle) for (let i = 1; i < rep.res.raf.length; i++) if (rep.res.raf[i][1] !== rep.res.raf[i - 1][1]) last = Math.max(last, rep.res.raf[i][0]);
  const t0 = (rep.now0 + offset) * 1000;
  const t1 = (last + offset) * 1000 + 30000;
  const named = (name, phases = ["X", "B"]) => events.filter((e) => e.pid === mark.pid && e.name === name && e.ts >= t0 && e.ts <= t1 && phases.includes(e.ph)).map((e) => e.ts / 1000).sort((a, b) => a - b);
  const draws = named("ProxyImpl::ScheduledActionDraw");
  const mains = named("ProxyMain::BeginMainFrame");
  const activations = named("ProxyImpl::DidActivateSyncTreeOnImplThread", ["X", "B", "I"]);
  let stale = 0;
  for (let i = 1, a = 0; i < draws.length; i++) {
    let fresh = false;
    for (; a < activations.length && activations[a] <= draws[i]; a++) if (activations[a] > draws[i - 1]) fresh = true;
    if (!fresh) stale++;
  }
  const mainTid = events.find((e) => e.ph === "M" && e.name === "thread_name" && e.pid === mark.pid && e.args?.name === "CrRendererMain")?.tid;
  const inGesture = (e) => e.pid === mark.pid && e.tid === mainTid && e.ph === "X" && e.ts >= t0 && e.ts <= (last + offset) * 1000;
  const scriptMs = (test) => {
    let total = 0;
    let end = -Infinity;
    for (const e of events.filter((e) => inGesture(e) && e.name === "FunctionCall" && test(e.args?.data?.url ?? "")).sort((a, b) => a.ts - b.ts)) {
      if (e.ts < end) continue;
      total += e.dur ?? 0;
      end = e.ts + (e.dur ?? 0);
    }
    return Math.round(total / 100) / 10;
  };
  const rafs = rep.res.raf.filter((r) => r[0] >= rep.now0 && r[0] <= last).map((r) => r[0]);
  const scrolls = rep.res.scroll.filter((s) => s[0] >= rep.now0 && s[0] <= last).map((s) => s[0]);
  const rafGaps = gaps(rafs);
  return {
    ms: Math.round(last - rep.now0),
    dy: rep.res.y1 - rep.res.y0,
    drawHz: rate(draws),
    drawsLate: gaps(draws).filter((g) => g > refreshMs * 1.5).length,
    mainHz: rate(mains),
    stalePct: draws.length > 1 ? Math.round((100 * stale) / (draws.length - 1)) : null,
    rafHz: rafGaps.length ? +(1000 / median(rafGaps)).toFixed(1) : null,
    rafOver12: rafGaps.length ? Math.round((100 * rafGaps.filter((g) => g > 12.5).length) / rafGaps.length) : null,
    scrollHz: rate(scrolls),
    mainBusyMs: Math.round(events.filter((e) => inGesture(e) && e.name === "ThreadControllerImpl::RunTask").reduce((sum, e) => sum + (e.dur ?? 0), 0) / 1000),
    pageScriptMs: scriptMs((url) => url.startsWith("ardia://page-script")),
    extensionMs: scriptMs((url) => /^chrome-extension:|^extensions::/.test(url)),
  };
}

const server = createServer((req, res) => {
  const name = new URL(req.url, "http://x").pathname.slice(1);
  if (!PAGES[name]) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  res.end(PAGES[name]());
});
await new Promise((r) => server.listen(pagePort, "127.0.0.1", r));

const screen = display();
console.log(`display: ${screen.name}, ${screen.maxHz} Hz${screen.locked ? ", LOCKED (no display-link frames: rerun unlocked)" : ""}`);
const refreshMs = 1000 / (+screen.maxHz || 60);
const results = [];
const acperf = acperfBin();
try {
  for (let round = 0; round < +opt.rounds; round++) {
    for (const arm of round % 2 ? [...arms].reverse() : arms) {
      const data = join(out, `data-${arm.label}`);
      const inst = await launch(arm.app, { data, port, js: "none", ready: false, fresh: true, onboarded: true, env: arm.env });
      try {
        let b = null;
        for (const end = Date.now() + 60000; !b && Date.now() < end; await sleep(200)) b = await inst.browser().catch(() => null);
        const { targetId } = await b.send("Target.createTarget", { url: `http://127.0.0.1:${pagePort}/article` });
        await b.send("Target.activateTarget", { targetId });
        let target = null;
        for (const end = Date.now() + 20000; !target && Date.now() < end; await sleep(150)) target = (await inst.targets()).find((t) => t.id === targetId);
        const d = await devtools(target);
        await sleep(3000);
        if (arm.battery) {
          await sleep(5000);
          const state = await batterySaver(data, "on");
          if (!state.active) throw new Error(`Battery Saver didn't turn on: ${JSON.stringify(state)}`);
        }
        for (const c of cases) {
          await d.send("Page.navigate", { url: `http://127.0.0.1:${pagePort}/${c.page}` });
          for (const end = Date.now() + 15000; Date.now() < end; await sleep(150)) if (await d.eval("document.readyState === 'complete' && !!window.__probe").catch(() => false)) break;
          if (+opt["cpu-throttle"] > 1) await d.send("Emulation.setCPUThrottlingRate", { rate: +opt["cpu-throttle"] });
          await sleep(1500);
          const geo = await d.eval("({ x: screenX, y: screenY, iw: innerWidth, ow: outerWidth, oh: outerHeight })");
          const wins = windowsOf(inst.pid);
          const w = wins.find((w) => w.b.X === geo.x && w.b.Y === geo.y) ?? wins[0];
          const at = { x: Math.round(geo.x + geo.ow - geo.iw / 2), y: Math.round(geo.y + geo.oh / 2) };
          await traceStart(b);
          await sleep(300);
          const done = [];
          for (let r = 0; r < reps; r++) {
            await d.eval("__probe.reset()");
            await sleep(1500);
            const mark = `scroll-frames-${r}`;
            const now0 = await d.eval(`(__probe.start(${!c.noRaf}), performance.mark(${JSON.stringify(mark)}), performance.now())`);
            if (c.src === "idle") await sleep(3000);
            else if (c.src === "keys") await keys(d);
            else if (c.src === "trackhold") {
              const p = spawnSync(acperf, ["postmouse", String(inst.pid), String(w.id), String(at.x - 8), String(at.y), String(w.b.X), String(w.b.Y), "3000"], { encoding: "utf8", timeout: 20000 });
              if (p.status !== 0) throw new Error(`acperf postmouse: ${p.stderr}`);
            }
            else {
              const p = spawnSync(acperf, ["postscroll", String(inst.pid), String(w.id), String(at.x), String(at.y), String(w.b.X), String(w.b.Y), c.src, String(c.rate ?? 120)], { encoding: "utf8", timeout: 20000 });
              if (p.status !== 0) throw new Error(`acperf postscroll: ${p.stderr}`);
            }
            await sleep(900);
            done.push({ mark, now0, idle: c.src === "idle", res: await d.eval("__probe.stop()") });
          }
          const events = await traceStop(b);
          const saver = arm.battery ? await batterySaver(data) : null;
          if (saver && !saver.active) throw new Error(`Battery Saver turned off during ${c.id}: ${JSON.stringify(saver)}`);
          for (const rep of done) {
            const row = { round, arm: arm.label, case: c.id, ...analyse(events, rep, refreshMs) };
            results.push(row);
            console.error(JSON.stringify(row));
          }
          writeFileSync(join(out, "results.json"), JSON.stringify({ display: screen, results }, null, 1));
        }
        b.close();
        d.close();
      } finally {
        await inst.quit();
      }
    }
  }
} finally {
  server.close();
}

const cols = ["mainHz", "stalePct", "rafHz", "rafOver12", "scrollHz", "drawHz", "drawsLate", "mainBusyMs", "pageScriptMs", "extensionMs"];
console.log(["case".padEnd(20), "arm".padEnd(12), "n", ...cols.map((c) => c.padStart(9))].join(" "));
for (const c of cases)
  for (const arm of arms) {
    const rows = results.filter((r) => r.case === c.id && r.arm === arm.label && !r.error);
    if (rows.length) console.log([c.id.padEnd(20), arm.label.padEnd(12), String(rows.length), ...cols.map((k) => String(median(rows.map((r) => r[k])) ?? "-").padStart(9))].join(" "));
  }
