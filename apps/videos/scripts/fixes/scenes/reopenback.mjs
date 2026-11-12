const UNLOAD = `addEventListener("beforeunload", () => { localStorage.setItem("leaving", String(Date.now())); }); addEventListener("unload", () => { localStorage.setItem("closedAt", String(Date.now())); }); "listening"`;

export default {
  session: "session-0246n2-reopen.json",
  minWidth: 1000,
  setup: `const s = st();
const go = (url) => { s.navigate("t1", url, { userInitiated: true }); return sleep(2600); };
return sleep(1500).then(() => go("http://dailyledger.example/")).then(() => go("http://docpad.example/"))
  .then(() => done({ back: !!st().live.t1 && st().live.t1.canGoBack, url: st().tabs.t1.url }));`,
  async prepare(instance) {
    const page = await instance.page("docpad");
    return { unload: await page.eval(UNLOAD) };
  },
  act: `const BACK = { x: 315, y: 30 };
const until = (f, ms) => { const end = Date.now() + ms; const loop = () => { const v = f(); if (v || Date.now() > end) return Promise.resolve(v || null); return sleep(50).then(loop); }; return loop(); };
const before = new Set(st().windowOrder);
let tab = null;
let old = null;
return at(640, 420).then(() => sleep(500)).then(() => move(BACK.x, BACK.y + 40, 700)).then(() => sleep(900))
  .then(() => key("⇧⌘W", CMD | SHIFT, "W", 13))
  .then(() => until(() => !st().windows.w1, 6000))
  .then(() => { hide(); old = N; N = null; return sleep(450); })
  .then(() => { mark("go"); return key("⇧⌘T", CMD | SHIFT, "T", 17); })
  .then(() => until(() => { const s = st(); const w = s.windowOrder.find((id) => !before.has(id)); return w && s.windows[w].tabIds.find((id) => (s.tabs[id].url || "").includes("docpad")); }, 8000))
  .then((t) => { tab = t; return ac.engine.call("windows.list"); })
  .then((ws) => { const mine = ws.filter((w) => w.hasRoot && w.window !== old && w.frame.indexOf("1120") > 0); N = mine.length ? mine[mine.length - 1].window : null; return until(() => tab && st().live[tab] && !st().live[tab].isLoading, 8000); })
  .then(() => sleep(900)).then(() => at(BACK.x + 160, BACK.y + 260)).then(() => move(BACK.x, BACK.y, 800)).then(() => sleep(350))
  .then(() => { mark("back"); return click(); })
  .then(() => sleep(2400))
  .then(() => JSON.stringify({ events, tab, back: !!(tab && st().live[tab] && st().live[tab].canGoBack), url: tab && st().tabs[tab].url, windows: st().windowOrder.length, n: N, old }));`,
  tail: 600,
};
