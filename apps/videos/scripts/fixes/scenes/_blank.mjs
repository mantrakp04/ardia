export const blankScene = (open) => ({
  session: "session-r46-blank.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `const row = (id) => ac.sidebarRows.measureRow(W, id).then((r) => ({ x: Math.round(r.x + 70), y: Math.round(r.y + r.height / 2) }));
const slowTab = () => st().windows[W].tabIds.map((id) => st().tabs[id]).find((t) => t && !["k1", "t1", "t4"].includes(t.id));
const seen = [];
const watch = setInterval(() => { const t = slowTab(); if (t) seen.push({ t: Date.now(), url: t.url, title: t.title }); }, 250);
let start = 0;
let slow = null;
return at(760, 620).then(() => sleep(700))
  .then(() => { start = Date.now(); return (${open})(); })
  .then(() => sleep(3200)).then(() => { slow = slowTab(); return key("⇧⌘C", CMD | SHIFT, "C", 8); })
  .then(() => sleep(700)).then(() => row("k1")).then((p) => move(p.x, p.y, 500)).then(() => sleep(150)).then(() => click())
  .then(() => sleep(400)).then(() => move(560, 330, 500)).then(() => sleep(150)).then(() => click())
  .then(() => sleep(250)).then(() => { mark("paste"); return key("⌘V", CMD, "v", 9); })
  .then(() => sleep(1100)).then(() => row(slow.id)).then((p) => move(p.x, p.y, 500)).then(() => sleep(150)).then(() => click())
  .then(() => move(760, 620, 700)).then(() => sleep(Math.max(0, start + 11000 - Date.now())))
  .then(() => { clearInterval(watch); return done({ seen: seen.map((s) => ({ t: s.t - start, url: s.url, title: s.title })), final: slowTab() && slowTab().url }); });`,
  tail: 400,
});
