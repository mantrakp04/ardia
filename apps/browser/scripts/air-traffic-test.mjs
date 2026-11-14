import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, session, sleep } from "../../../scripts/lib/instance.mjs";

const appArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node air-traffic-test.mjs <Debug Ardia.app>");
  console.error("Checks Air Traffic Control in a hidden instance: a link from another app (a real GURL Apple Event) into a tab group, trusted plain and ⌘-clicks on a Personal page that a rule sends to Work (one on a link whose page handler stops the click's propagation), a click no rule takes, and an address typed in a Personal tab's address bar.");
  process.exit(2);
}
const app = resolve(appArg);
const root = mkdtempSync(join(tmpdir(), "air-traffic-"));
const gurl = join(root, "gurl");
execFileSync("swiftc", ["-O", resolve(import.meta.dirname, "../../../.claude/skills/release/scripts/gurl.swift"), "-o", gurl]);
const failures = [];

const PAGE = `<!doctype html><title>source</title><body style="margin:0;font:20px sans-serif">
<a id="routed" href="https://example.net/routed" style="display:block;height:60px">routed</a>
<a id="meta" href="https://example.net/meta" style="display:block;height:60px">meta</a>
<a id="plain" href="/plain" style="display:block;height:60px">plain</a>
<div id="root"><a id="stopped" href="https://example.net/stopped" style="display:block;height:60px">stopped</a></div>
<script>document.getElementById("root").addEventListener("click", (e) => e.stopPropagation());</script></body>`;
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(req.url === "/" ? PAGE : `<!doctype html><title>${req.url}</title>${req.url}`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

function record(name, ok, detail) {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(detail)}`}`);
}

async function until(test, ms = 8000) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if ((last = await test())?.ok) return last;
  return last;
}

const data = join(root, "data");
mkdirSync(data, { recursive: true });
writeFileSync(join(data, "session.json"), JSON.stringify(session({
  profiles: ["Personal", "Work"],
  windows: [{ id: "w1" }, { id: "w2", profileId: "work" }],
  tabs: [{ id: "t1", url: `${origin}/`, windowId: "w1" }, { id: "t2", url: `${origin}/inbox`, windowId: "w2" }],
})));
writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));

const inst = await launch(app, { data, js: "live" });
const tabsAt = (url) => inst.eval(`const s = ac.store.getState();
  return Object.values(s.tabs).filter((t) => (t.url || t.page?.nav?.url) === ${JSON.stringify(url)})
    .map((t) => ({ id: t.id, profileId: t.profileId, active: s.windows[t.windowId]?.activeTabIds[t.profileId] === t.id,
      groups: Object.values(s.groups).filter((g) => g.tabIds.includes(t.id)).map((g) => g.id) }));`);
const sourceUrl = () => inst.eval(`return ac.store.getState().tabs.t1.url;`);

try {
  await sleep(1500);
  const group = await inst.eval(`const s = ac.store.getState(); const g = s.groupTabs(["t2"], { name: "Inbox" }); s.updateGroup(g, { collapsed: true });
    const key = ac.store.getState().groups[g].pinKey ?? g;
    ac.airTraffic.addAirTrafficRule({ enabled: true, from: null, when: { kind: "site", host: "example.net" }, profileId: "work", open: "tab", inside: true });
    ac.airTraffic.addAirTrafficRule({ enabled: true, from: null, when: { kind: "site", host: "example.org" }, profileId: "work", open: "tab", groupKey: key, inside: false });
    s.activate("t1");
    return g;`);
  await sleep(1000);

  execFileSync(gurl, [String(inst.pid), "https://example.org/grouped"], { timeout: 15000 });
  const grouped = await until(async () => {
    const [tab] = await tabsAt("https://example.org/grouped");
    const expanded = await inst.eval(`return !ac.store.getState().groups[${JSON.stringify(group)}]?.collapsed;`);
    return { ok: !!tab && tab.profileId === "work" && tab.groups.includes(group) && expanded, tab, expanded };
  });
  record("a link from another app joins the rule's tab group and opens it", grouped?.ok, grouped);
  await inst.eval(`ac.store.getState().activate("t1"); return true;`);
  await sleep(800);

  const page = await inst.page((t) => t.url === `${origin}/`);
  const click = async (id, modifiers = 0) => {
    const r = await page.eval(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.left + 20, y: b.top + 20 }; })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y, modifiers });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1, modifiers });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1, modifiers });
  };

  await click("routed");
  const plain = await until(async () => {
    const [tab] = await tabsAt("https://example.net/routed");
    const source = await sourceUrl();
    return { ok: !!tab && tab.profileId === "work" && tab.active && source === `${origin}/`, tab, source };
  });
  record("a plain click on a routed link opens a foreground Work tab and leaves the Personal page", plain?.ok, plain);

  await inst.eval(`ac.store.getState().activate("t1"); return true;`);
  await sleep(800);
  await click("meta", 4);
  const meta = await until(async () => {
    const [tab] = await tabsAt("https://example.net/meta");
    const source = await sourceUrl();
    return { ok: !!tab && tab.profileId === "work" && !tab.active && source === `${origin}/`, tab, source };
  });
  record("a ⌘-click on a routed link opens a background Work tab and leaves the Personal page", meta?.ok, meta);

  await inst.eval(`ac.store.getState().activate("t1"); return true;`);
  await sleep(800);
  await click("stopped");
  const stopped = await until(async () => {
    const [tab] = await tabsAt("https://example.net/stopped");
    const source = await sourceUrl();
    return { ok: !!tab && tab.profileId === "work" && source === `${origin}/`, tab, source };
  });
  record("a routed link whose page handler stops the click's propagation still opens in Work", stopped?.ok, stopped);

  const before = await inst.eval(`return Object.keys(ac.store.getState().tabs).length;`);
  await click("plain");
  const normal = await until(async () => {
    const source = await sourceUrl();
    const count = await inst.eval(`return Object.keys(ac.store.getState().tabs).length;`);
    return { ok: source === `${origin}/plain` && count === before, source, count, before };
  });
  record("a click on a link no rule takes navigates the page as usual", normal?.ok, normal);
  page.close();

  const typed = await inst.eval(`const s = ac.store.getState(); s.activate("t1"); s.openPanel("w1"); return true;`).then(async () => {
    const id = await until(async () => {
      const found = await inst.eval(`return ac.omnibox.ids().find((i) => i.startsWith("w1:") && !i.includes("hero")) ?? null;`);
      return { ok: !!found, found };
    });
    await sleep(800);
    await inst.eval(`const d = ac.omnibox.get(${JSON.stringify(id?.found)}); d.type("example.net/x"); return true;`);
    await sleep(800);
    await inst.eval(`ac.omnibox.get(${JSON.stringify(id?.found)}).submit(); return true;`);
    return until(async () => {
      const [tab] = await tabsAt("https://example.net/x");
      const source = await sourceUrl();
      return { ok: !!tab && tab.profileId === "work" && source === `${origin}/plain`, tab, source, bar: id?.found };
    });
  });
  record("an address typed in a Personal tab's address bar opens a Work tab and keeps the source tab", typed?.ok, typed);

} finally {
  await inst.quit();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
console.log(failures.length ? `${failures.length} failed: ${failures.join(", ")}` : "all passed");
process.exit(failures.length ? 1 : 0);
