#!/usr/bin/env node
// Tab actions from the AppKit event to the last paint of their result, on a Release app with a swapped JS bundle, in
// hidden instances. The session looks like a real one: 60 tabs over 2 profiles, 10 pinned tiles and 5 pinned rows,
// 4 groups (one expanded), audible and loading tabs, 2 windows.
//
//   node tab-actions.mjs run --app <Release Ardia.app> --side <label>=<main.jsbundle> [--side <label>=<bundle>]
//        [--side-env <label>:K=V] [--side-app <label>=<Release Ardia.app>] [--launches 4] [--n 5] [--actions a,b] [--out dir] [--port 9317] [--page-port 47917]
//       Each launch runs every action --n times; launches alternate between the sides (A B B A ...), so the sides
//       share the machine. Writes <out>/samples.jsonl, one line per action.
//   node tab-actions.mjs fixture <session.json> [--page-port 47917]   the session alone; serve: its pages alone
//   node tab-actions.mjs report <out>
//       Per side and action: median and p90 of event → last paint, its split, and React renders per action.
//
// Actions: click (sidebar row), ctrlTab (⌃Tab tapped: the switch lands on ⌃'s release), cmdNumber (⌘2/⌘7 between
// pinned tabs), cmdT (new tab), cmdClick (⌘-click a link: a background tab), cmdW (close a loaded tab), hoverClose
// (the row's ✕), pin and unpin (Tabs › Pin), moveDown (⌃⇧PgDn).
//
// What is timed. The start is the AppKit event (its own timestamp, read by actabs.m's event monitor; for ⌃Tab the
// flagsChanged that releases ⌃, for a click its mouse-up, which is what fires it, with the mouse-down in `press`;
// for Tabs › Pin the menu action). The phases:
//   event → store       the store has the action's change (a store listener added last, after every other listener)
//   store → commit      React's render and commit of it (the first commit after the store change)
//   layout              React's commit → the UI manager's flush (Yoga layout on the shadow queue)
//   main wait           the flush → its blocks start on the main thread
//   UI blocks           the blocks: native views created, updated, moved (actabs.m)
//   display+CA commit   the blocks' end → Core Animation's commit of that transaction (AppKit layout, views drawn, commit)
//   first paint         event → that commit, for the first React commit after the store change
//   ui                  event → the commit of the last React commit within 500 ms that changed anything on screen (a flush
//                       Core Animation doesn't commit within 60 ms had nothing to draw)
//   page                event → the shown page's second requestAnimationFrame after it turned visible (CDP; switches)
//   total               the later of ui and page
// Counts per action (perf probe): React commits, renders (host wrappers included), store updates; with
// --side-env <label>:AC_BENCH_COUNT_ADDS=1, the subviews added again (already in place) and added new (reAdds, newAdds).

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const flags = { side: [], "side-env": [], "side-app": [] };
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) positional.push(rest[i]);
  else if (rest[i] === "--side") flags.side.push(rest[++i]);
  else if (rest[i] === "--side-env") flags["side-env"].push(rest[++i]);
  else if (rest[i] === "--side-app") flags["side-app"].push(rest[++i]);
  else flags[rest[i].slice(2)] = rest[++i];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (xs, q) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const ALL = ["click", "ctrlTab", "cmdNumber", "cmdT", "cmdClick", "cmdW", "hoverClose", "pin", "unpin", "moveDown"];

function toolLibrary(out) {
  const lib = join(out, "actabs.dylib");
  const src = join(here, "actabs.m");
  if (!existsSync(lib) || readFileSync(src, "utf8") !== (existsSync(lib + ".src") ? readFileSync(lib + ".src", "utf8") : "")) {
    execFileSync("clang", ["-dynamiclib", "-fobjc-arc", "-framework", "AppKit", "-framework", "QuartzCore", "-arch", "arm64", src, "-o", lib], { stdio: "inherit" });
    execFileSync("codesign", ["--force", "--sign", "-", lib]);
    writeFileSync(lib + ".src", readFileSync(src, "utf8"));
  }
  return lib;
}

function prepare(app, bundle, dir) {
  const copy = join(dir, "Ardia.app");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("cp", ["-Rc", app, copy]);
  cpSync(bundle, join(copy, "Contents/Resources/main.jsbundle"));
  const identity = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr.match(/^Authority=(.+)$/m)?.[1] ?? "-";
  const granted = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8" });
  const extra = ["com.apple.security.cs.allow-dyld-environment-variables", "com.apple.security.cs.disable-library-validation"]
    .filter((key) => !granted.includes(`<key>${key}</key>`)).map((key) => `<key>${key}</key><true/>`).join("");
  const entitlements = join(dir, "entitlements.plist");
  writeFileSync(entitlements, granted.replace(/<\/dict>\s*<\/plist>\s*$/, `${extra}</dict></plist>`));
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime", "--entitlements", entitlements, copy], { stdio: "ignore" });
  return copy;
}

const VIS = `<script>window.__ac={vis:[]};document.addEventListener("visibilitychange",()=>{if(document.visibilityState!=="visible")return;const v=performance.timeOrigin+performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>__ac.vis.push({v,f:performance.timeOrigin+performance.now()})))});</script>`;

function serve(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const name = url.pathname.split("/").pop();
    if (url.pathname.startsWith("/slow/")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.write(`<title>Slow ${name}</title>${VIS}<p>loading forever`);
      return;
    }
    const audio = url.pathname.startsWith("/audio/")
      ? `<script>addEventListener("load",()=>{const c=new AudioContext();const o=c.createOscillator();const g=c.createGain();g.gain.value=0.001;o.connect(g).connect(c.destination);o.start();});</script>`
      : "";
    const rows = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} of ${name}: lorem ipsum dolor sit amet.</p>`).join("");
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(`<!doctype html><title>Page ${name}</title>${VIS}${audio}<style>body{font:15px -apple-system;margin:40px;background:#fdfcf9}a{display:block;font-size:22px;padding:20px 0}</style><h1>${name}</h1><a id="link" href="/p/${name}-child">Open a child of ${name}</a>${rows}`);
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

export function fixture(origin) {
  const now = Date.now();
  const tabs = [];
  const groups = [];
  let n = 0;
  const tab = (windowId, profileId, extra = {}) => {
    const id = `t${++n}`;
    const t = {
      id, windowId, profileId, url: `${origin}/p/${id}`, title: `Page ${id}`, favicon: null, pinned: false, muted: false, zoom: 1,
      customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: now - (200 - n) * 60_000,
      lastActiveAt: now - (200 - n) * 60_000, ...extra,
    };
    if (t.pinned) t.pinnedUrl = t.url;
    tabs.push(t);
    return id;
  };
  const group = (windowId, profileId, name, ids, collapsed) => {
    groups.push({ id: `g${groups.length + 1}`, windowId, profileId, name, icon: null, color: "blue", collapsed, pinned: false, tabIds: ids, createdAt: now });
    return ids;
  };
  const w1 = "w-tabs-1", w2 = "w-tabs-2";
  const p = (w, profile, count, extra = () => ({})) => Array.from({ length: count }, (_, i) => tab(w, profile, extra(i)));
  const personal = [
    ...p(w1, "default", 6, () => ({ pinned: true })),
    ...p(w1, "default", 3, () => ({ pinned: true, pinnedAsRow: true })),
    ...group(w1, "default", "Reading", p(w1, "default", 5), false),
    ...group(w1, "default", "Errands", p(w1, "default", 4), true),
    ...p(w1, "default", 18, (i) => (i === 3 || i === 9 ? { url: `${origin}/audio/a${i}`, muted: true } : i === 6 || i === 12 ? { url: `${origin}/slow/s${i}` } : {})),
  ];
  const work = [
    ...p(w1, "work", 4, () => ({ pinned: true })),
    ...p(w1, "work", 2, () => ({ pinned: true, pinnedAsRow: true })),
    ...group(w1, "work", "Sprint", p(w1, "work", 4), true),
    ...p(w1, "work", 8),
  ];
  const second = [...group(w2, "default", "Later", p(w2, "default", 3), true), ...p(w2, "default", 3)];
  const at = (list, i) => list[i];
  const session = {
    version: 2,
    profiles: {
      default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
      work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 },
    },
    profileOrder: ["default", "work"],
    orphanedProfileData: [],
    settings: { searchSuggestions: false, warnBeforeClosingLastTab: false, warnBeforeClosingWindow: false },
    windows: [
      { id: w1, profileId: "default", incognito: false, tabIds: [...personal, ...work], activeTabIds: { default: at(personal, 20), work: at(work, 12) }, sidebarOpen: true, frame: [60, 60, 1440, 900], createdAt: now },
      { id: w2, profileId: "default", incognito: false, tabIds: second, activeTabIds: { default: at(second, 4) }, sidebarOpen: true, frame: [200, 120, 1100, 760], createdAt: now + 1 },
    ],
    windowOrder: [w1, w2],
    focusedWindowId: w1,
    tabs,
    groups,
    splits: [],
    closedTabs: [],
    closedWindows: [],
  };
  return { session, w1, w2, personal, work, second };
}

class Rig {
  constructor(instance, data) {
    this.i = instance;
    this.data = data;
    this.seq = 0;
    this.offset = 0;
    this.pages = new Map();
  }
  async op(cmd, timeout = 5000) {
    const id = `op${Date.now()}-${++this.seq}`;
    const file = join(this.data, "bench-tabs-result.json");
    writeFileSync(join(this.data, "bench-tabs-cmd.json"), JSON.stringify({ ...cmd, id }));
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(5)) {
      try {
        const r = JSON.parse(readFileSync(file, "utf8"));
        if (r.id === id) {
          if (!r.ok) throw new Error(`${cmd.op}: ${r.error}`);
          return r;
        }
      } catch (e) {
        if (String(e.message).startsWith(`${cmd.op}:`)) throw e;
      }
    }
    throw new Error(`${cmd.op} timed out`);
  }
  records(from) {
    const lines = existsSync(join(this.data, "bench-tabs.jsonl")) ? readFileSync(join(this.data, "bench-tabs.jsonl"), "utf8").split("\n") : [];
    return lines.flatMap((l) => {
      try {
        const r = JSON.parse(l);
        return (r.k === "e" ? r.made : r.q) >= from ? [r] : [];
      } catch {
        return [];
      }
    });
  }
  eval(body, timeout) {
    return this.i.eval(body, { timeout });
  }
  async install() {
    return this.eval(`
      const S = () => ac.store.getState();
      const state = (s) => {
        const w = s.windows[s.ui.focusedWindowId];
        return w ? [s.ui.focusedWindowId, w.profileId, w.activeTabIds[w.profileId], w.tabIds.length, w.tabIds.filter((id) => s.tabs[id]?.pinned).length, w.tabIds.join(",")].join("|") : "";
      };
      const tb = globalThis.__tb = { changes: [], last: state(S()), offset: Date.now() - performance.now() };
      ac.store.subscribe((s) => {
        const key = state(s);
        tb.changes.push({ t: performance.now() + tb.offset, changed: key !== tb.last });
        tb.last = key;
        if (tb.changes.length > 400) tb.changes.splice(0, 200);
      });
      return tb.offset;`);
  }
  async begin() {
    await this.eval(`globalThis.acPerf.reset(); __tb.changes.length = 0; return true;`);
    return Date.now();
  }
  async collect() {
    return this.eval(`
      const r = globalThis.acPerf.read();
      const renders = Object.values(r.renders ?? {}).reduce((a, b) => a + b, 0);
      const top = Object.entries(r.renders ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const offset = __tb.offset;
      return { changes: __tb.changes, commits: r.commitTimes.map((t) => t + offset), renders, top, storeUpdates: r.storeUpdates ?? 0,
        hostUpdates: Object.values(r.hostUpdates ?? {}).reduce((a, b) => a + b, 0), mounts: Object.values(r.mounts ?? {}).reduce((a, b) => a + b, 0) };`);
  }
  async page(tabId) {
    const s = await this.store(`const t = S().tabs[${JSON.stringify(tabId)}]; return t ? t.url : null;`);
    if (!s) return null;
    let p = this.pages.get(s);
    if (!p || p.closed) {
      p = await this.i.page((t) => t.url === s, { timeout: 4000 }).catch(() => null);
      if (p) this.pages.set(s, p);
    }
    return p;
  }
  store(body) {
    return this.eval(`const S = () => ac.store.getState(); ${body}`);
  }
}

const KEYS = { tab: 48, pagedown: 121, t: 17, w: 13, 2: 19, 7: 26 };

async function rowPoint(rig, windowId, tabId) {
  return rig.eval(`return ac.sidebarRows.measureRow(${JSON.stringify(windowId)}, ${JSON.stringify(tabId)});`);
}

async function windowNumber(rig, frame) {
  const { windows } = await rig.op({ op: "windows" });
  const match = windows.find((w) => Math.abs(w.w - frame[2]) < 2 && Math.abs(w.h - frame[3]) < 40) ?? windows[0];
  return match;
}

function analyse(rec, startAt, endWindow = 500) {
  const { changes, commits, flushes, pageFrame } = rec;
  const store = changes.find((c) => c.changed && c.t >= startAt - 1)?.t ?? changes.find((c) => c.t >= startAt - 1)?.t ?? NaN;
  const inWindow = commits.filter((t) => t >= (Number.isFinite(store) ? store : startAt) - 0.5 && t <= startAt + endWindow);
  const flushAfter = (t) => flushes.find((f) => f.q >= t - 0.5);
  const painted = inWindow.map((t) => ({ t, f: flushAfter(t) })).filter((x) => x.f && x.f.c - x.f.b < 60);
  const first = painted[0];
  const last = painted[painted.length - 1];
  const ui = last ? last.f.c - startAt : NaN;
  const page = Number.isFinite(pageFrame) ? pageFrame - startAt : NaN;
  return {
    store: store - startAt,
    commit: first ? first.t - store : NaN,
    layout: first ? first.f.q - first.t : NaN,
    mainWait: first ? first.f.a - first.f.q : NaN,
    blocks: first ? first.f.b - first.f.a : NaN,
    display: first ? first.f.c - first.f.b : NaN,
    firstPaint: first ? first.f.c - startAt : NaN,
    ui,
    page,
    total: Math.max(Number.isFinite(ui) ? ui : -Infinity, Number.isFinite(page) ? page : -Infinity),
    commitsInWindow: inWindow.length,
    paints: painted.length,
  };
}

async function runAction(rig, ctx, name) {
  const { w1 } = ctx;
  const S = (body) => rig.store(body);
  const focus = async () => S(`if (S().ui.focusedWindowId !== ${JSON.stringify(w1)}) S().focusWindow?.(${JSON.stringify(w1)}); return S().ui.focusedWindowId;`);
  await focus();
  const viewList = () => S(`const s = S(), w = s.windows[${JSON.stringify(w1)}]; return w.tabIds.filter((id) => s.tabs[id].profileId === w.profileId && !s.tabs[id].pinned && !s.groups[Object.keys(s.groups).find((g) => s.groups[g].tabIds.includes(id))]?.collapsed);`);
  const active = () => S(`const w = S().windows[${JSON.stringify(w1)}]; return w.activeTabIds[w.profileId];`);
  let expectTab = null;
  let start = "event";
  let send;
  const key = (chars, keyCode, mods, extra = {}) => () => rig.op({ op: "key", window: ctx.win.number, chars, keyCode, mods, ...extra });
  const activate = (id) => S(`S().setSelection(${JSON.stringify(w1)}, []); S().activate(${JSON.stringify(id)}); return true;`);
  const shown = async (ids) => {
    const tiles = await S(`const s = S(), w = s.windows[${JSON.stringify(w1)}]; return w.tabIds.filter((id) => s.tabs[id].profileId === w.profileId && s.tabs[id].pinned && !s.tabs[id].pinnedAsRow);`);
    let top = 60;
    for (const id of tiles) {
      const r = await rowPoint(rig, w1, id);
      if (r) top = Math.max(top, r.y + r.height + 6);
    }
    const out = [];
    for (const id of ids) {
      const r = await rowPoint(rig, w1, id);
      if (r && r.y > top && r.y + r.height < ctx.frame[3] - 70) out.push(id);
    }
    return out;
  };
  const list = (await viewList()).filter((id) => !ctx.skip.has(id));
  if (name === "click" || name === "hoverClose") {
    const cur = await active();
    const candidates = (await shown(list.filter((id) => id !== cur))).slice(0, 10);
    const target = candidates[ctx.iter % candidates.length];
    if (name === "hoverClose") {
      const id = await S(`return S().newTab(${JSON.stringify(w1)}, { url: ${JSON.stringify(`${ctx.origin}/p/close-${Date.now()}`)}, background: false });`);
      await sleep(900);
      const r = await rowPoint(rig, w1, id);
      if (!r) throw new Error("no row for the new tab");
      await rig.eval(`const f = acPerf.findFibers("TabRow", 400).find((f) => f.memoizedProps.tabId === ${JSON.stringify(id)});
        let host = null;
        for (let c = f?.child; c && !host; c = c.child) if (c.tag === 5) host = c;
        host?.memoizedProps.onMouseEnter?.();
        return !!host;`);
      await sleep(250);
      send = () => rig.op({ op: "click", window: ctx.win.number, x: r.x + r.width - 6 - 11, y: r.y + r.height / 2, holdMs: 60 });
      start = "up";
    } else {
      await activate(cur);
      const r = await rowPoint(rig, w1, target);
      if (!r) throw new Error(`no row for ${target}`);
      expectTab = target;
      send = () => rig.op({ op: "click", window: ctx.win.number, x: r.x + r.width / 2, y: r.y + r.height / 2, holdMs: 60 });
      start = "up";
    }
  } else if (name === "ctrlTab") {
    const ids = list.slice(2, 8);
    await activate(ids[ctx.iter % 2 ? 0 : 1]);
    await sleep(300);
    await activate(ids[ctx.iter % 2 ? 1 : 0]);
    expectTab = ids[ctx.iter % 2 ? 0 : 1];
    send = key("\t", KEYS.tab, ["ctrl"], { holdMs: 30, releaseMs: 20 });
    start = "release";
  } else if (name === "cmdNumber") {
    const digit = ctx.iter % 2 ? "2" : "7";
    send = key(digit, KEYS[digit], ["cmd"]);
  } else if (name === "cmdT") {
    send = key("t", KEYS.t, ["cmd"]);
  } else if (name === "cmdW") {
    await S(`S().newTab(${JSON.stringify(w1)}, { url: ${JSON.stringify(`${ctx.origin}/p/w-${Date.now()}`)} }); return true;`);
    await sleep(1200);
    send = key("w", KEYS.w, ["cmd"]);
  } else if (name === "cmdClick") {
    const cur = await active();
    const page = await rig.page(cur);
    if (!page) throw new Error("no page for the active tab");
    const box = await page.eval(`(() => { const r = document.getElementById("link").getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
    const webs = (await windowNumber(rig, ctx.frame)).webs.sort((a, b) => b.w * b.h - a.w * a.h);
    const web = webs[0];
    if (!web) throw new Error("no web view on screen");
    send = () => rig.op({ op: "click", window: ctx.win.number, x: web.x + box.x, y: web.y + box.y, mods: ["cmd"], holdMs: 60 });
    start = "up";
  } else if (name === "pin" || name === "unpin") {
    const ids = list.slice(4, 14);
    if (name === "pin") {
      const id = ids[ctx.iter % ids.length];
      await activate(id);
      (ctx.pinned ??= []).push(id);
    } else if (ctx.pinned?.length) {
      await activate(ctx.pinned.shift());
    }
    await sleep(300);
    const pinned = await S(`const s = S(), w = s.windows[${JSON.stringify(w1)}]; return s.tabs[w.activeTabIds[w.profileId]].pinned;`);
    if ((name === "pin") === pinned) return null;
    send = () => rig.op({ op: "menu", path: ["Tabs", "Move to Top Apps|Unpin from Top Apps"] });
  } else if (name === "moveDown") {
    const ids = list.slice(12, 18);
    await activate(ids[ctx.iter % ids.length]);
    send = key("", KEYS.pagedown, ["ctrl", "shift"], { chars: String.fromCharCode(0xf72d) });
  }
  await sleep(600);
  const shape = () => S(`const s = S(), w = s.windows[${JSON.stringify(w1)}]; const a = w.activeTabIds[w.profileId]; return { count: w.tabIds.length, pinned: !!s.tabs[a]?.pinned, index: w.tabIds.indexOf(a), active: a };`);
  const was = await shape();
  const before = await active();
  if (ctx.countAdds) await rig.op({ op: "adds", reset: true });
  const t0 = await rig.begin();
  const sent = await send();
  await sleep(1000);
  const got = await rig.collect();
  const adds = ctx.countAdds ? await rig.op({ op: "adds", reset: true }) : null;
  const after = await active();
  const now = await shape();
  const worked = {
    click: after === expectTab, hoverClose: now.count === was.count - 1, ctrlTab: after === expectTab, cmdNumber: after !== before, cmdT: now.count === was.count + 1,
    cmdW: now.count === was.count - 1, cmdClick: now.count === was.count + 1, pin: now.pinned && !was.pinned, unpin: was.pinned && !now.pinned, moveDown: now.index !== was.index,
  }[name];
  const events = rig.records(t0).filter((r) => r.k === "e");
  const flushes = rig.records(t0).filter((r) => r.k === "u").sort((a, b) => a.q - b.q);
  let startAt = sent.down;
  if (start === "up") startAt = events.find((e) => e.t === 2 && e.made >= sent.down - 1)?.made ?? sent.up;
  if (start === "release") startAt = sent.released;
  let pageFrame = NaN;
  if (after !== before) {
    const page = await rig.page(after);
    if (page) {
      const vis = await page.eval(`window.__ac ? __ac.vis : []`).catch(() => []);
      pageFrame = vis.find((v) => v.v >= startAt - 2)?.f ?? NaN;
    }
  }
  const timing = analyse({ changes: got.changes, commits: got.commits, flushes, pageFrame }, startAt);
  if (name === "cmdT") {
    await S(`const w = S().windows[${JSON.stringify(w1)}]; const id = w.activeTabIds[w.profileId]; if (!S().tabs[id].url) S().closeTab(id); return true;`);
  }
  if (name === "cmdClick") {
    await S(`const s = S(), w = s.windows[${JSON.stringify(w1)}]; for (const id of w.tabIds) if (s.tabs[id].url.includes("-child")) S().closeTab(id); return true;`);
  }
  return {
    action: name, worked, ...(adds ? { reAdds: adds.reAdds, newAdds: adds.newAdds } : {}), ...timing, press: start === "up" ? startAt - sent.down : 0, switched: after !== before, expect: expectTab, landed: after,
    renders: got.renders, commits: got.commits.length, storeUpdates: got.storeUpdates, hostUpdates: got.hostUpdates, mounts: got.mounts, top: got.top,
  };
}

async function oneLaunch(side, opts, out) {
  const data = join(out, "data", `${side.label}-${opts.launch}`);
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  const origin = `http://127.0.0.1:${opts.pagePort}`;
  const fx = fixture(origin);
  const instance = await launch(side.app, {
    data, port: opts.port, js: "none", onboarded: true, probe: true, session: fx.session,
    env: { DYLD_INSERT_LIBRARIES: opts.lib, AC_BENCH_TABS: "1", ...side.env },
    switches: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    args: ["-NSAppSleepDisabled", "YES"],
    ready: "return !!globalThis.acPerf && !!ac.store.getState().windows['w-tabs-1']",
  });
  const rig = new Rig(instance, data);
  try {
    await rig.install();
    await sleep(3000);
    const win = await windowNumber(rig, fx.session.windows[0].frame);
    const ctx = { ...fx, origin, win, frame: fx.session.windows[0].frame, skip: new Set(), iter: 0, countAdds: !!side.env.AC_BENCH_COUNT_ADDS };
    const warm = await rig.store(`const s = S(), w = s.windows["w-tabs-1"]; return w.tabIds.filter((id) => s.tabs[id].profileId === w.profileId && !s.tabs[id].url.includes("/slow/"));`);
    for (const id of warm) {
      await rig.store(`S().activate(${JSON.stringify(id)}); return true;`);
      await sleep(120);
    }
    await sleep(1500);
    for (const name of opts.actions) {
      for (let k = 0; k < opts.n; k++) {
        ctx.iter = opts.launch * opts.n + k;
        let sample;
        try {
          sample = await runAction(rig, ctx, name);
        } catch (e) {
          sample = { action: name, error: String(e.message ?? e) };
        }
        if (!sample) continue;
        const line = { side: side.label, launch: opts.launch, iter: k, ...sample };
        appendFileSync(join(out, "samples.jsonl"), JSON.stringify(line) + "\n");
        console.log(`${side.label} ${name} ${k}: ${sample.error ?? `total ${sample.total?.toFixed(1)} ui ${sample.ui?.toFixed(1)} page ${sample.page?.toFixed(1)} renders ${sample.renders}`}`);
      }
    }
  } finally {
    for (const p of rig.pages.values()) p.close();
    await instance.quit({ timeout: 8000 });
  }
}

async function run() {
  const app = resolve(flags.app ?? "");
  if (!flags.app || !flags.side.length) throw new Error("run needs --app and at least one --side label=bundle");
  const out = resolve(flags.out ?? "/tmp/ac-tab-actions");
  mkdirSync(out, { recursive: true });
  const lib = toolLibrary(out);
  const sides = flags.side.map((s) => {
    const [label, bundle] = s.split("=");
    const env = Object.fromEntries(flags["side-env"].filter((e) => e.startsWith(`${label}:`)).map((e) => e.slice(label.length + 1).split("=")));
    const own = flags["side-app"].find((e) => e.startsWith(`${label}=`))?.slice(label.length + 1);
    return { label, bundle: resolve(bundle), env, app: prepare(own ? resolve(own) : app, resolve(bundle), join(out, "apps", label)) };
  });
  const server = await serve(+(flags["page-port"] ?? 47917));
  const launches = +(flags.launches ?? 4);
  const actions = flags.actions ? flags.actions.split(",") : ALL;
  try {
    for (let l = 0; l < launches; l++) {
      const order = l % 2 ? [...sides].reverse() : sides;
      for (const side of order)
        await oneLaunch(side, { launch: l, n: +(flags.n ?? 5), actions, port: +(flags.port ?? 9317), pagePort: +(flags["page-port"] ?? 47917), lib }, out);
    }
  } finally {
    server.close();
  }
}

function report() {
  const out = resolve(positional[0] ?? "/tmp/ac-tab-actions");
  const samples = readFileSync(join(out, "samples.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const sides = [...new Set(samples.map((s) => s.side))];
  const actions = [...new Set(samples.map((s) => s.action))];
  const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");
  console.log("| action | side | n | total median | total p90 | first paint | event→store | store→commit | layout | main wait | UI blocks | display+CA commit | page | renders | commits | errors |");
  console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const a of actions)
    for (const side of sides) {
      const all = samples.filter((s) => s.action === a && s.side === side);
      const ok = all.filter((s) => !s.error && s.worked !== false && Number.isFinite(s.total));
      const m = (k, q = 0.5) => quantile(ok.map((s) => s[k]), q);
      console.log(`| ${a} | ${side} | ${ok.length} | ${f(m("total"))} | ${f(m("total", 0.9))} | ${f(m("firstPaint"))} | ${f(m("store"))} | ${f(m("commit"))} | ${f(m("layout"))} | ${f(m("mainWait"))} | ${f(m("blocks"))} | ${f(m("display"))} | ${f(m("page"))} | ${f(m("renders"))} | ${f(m("commits"))} | ${all.length - ok.length} |`);
    }
}

if (command === "run") await run();
else if (command === "report") report();
else if (command === "fixture") writeFileSync(positional[0], JSON.stringify(fixture(`http://127.0.0.1:${flags["page-port"] ?? 47917}`).session));
else if (command === "serve") await serve(+(flags["page-port"] ?? 47917));
else {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""));
  console.log(header.join("\n"));
  process.exit(command === "--help" || command === "-h" ? 0 : 2);
}
