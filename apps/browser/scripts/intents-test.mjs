import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, port] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: node intents-test.mjs <Debug Ardia.app> [cdpPort]");
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), "ac-intents-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "intents-test.log"), { name: "intents-test" });

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${req.url.split("?")[0].slice(1) || "home"}</title><body>${req.url}`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const page = (path) => `${origin}/${path}`;

let app;
try {
  app = await launch(resolve(appArg), {
    data, port,
    session: session({
      profiles: ["Personal", "Work"],
      tabs: [{ id: "t1", url: page("tracked?utm_source=shortcuts&id=7"), title: "tracked" }, { id: "t2", url: page("plain"), title: "plain" }],
    }),
    ready: "return !!globalThis.expo.modules.ArdiaDev.devRunIntent",
  });
  const ac = (body) => app.eval(body, { timeout: 30000 });
  const run = (name, args = {}) => ac(`return globalThis.expo.modules.ArdiaDev.devRunIntent(${JSON.stringify(name)}, ${JSON.stringify(args)});`);
  const tabAt = (url) => ac(`const s = ac.store.getState(); const t = Object.values(s.tabs).find((t) => t.url === ${JSON.stringify(url)}); const w = t && s.windows[t.windowId];
    return t ? { id: t.id, profileId: t.profileId, windowId: t.windowId, small: w?.kind === "small", windowProfile: w?.profileId, focused: s.ui.focusOrder[0] === t.windowId } : null;`);
  const opened = async (url) => {
    for (let i = 0; i < 40; i++) {
      const t = await tabAt(url);
      if (t) return t;
      await sleep(150);
    }
    throw new Error(`${url} never opened`);
  };
  const littleArdiaSetting = (on) => ac(`ac.store.getState().updateSettings({ openLinksInLittleArdia: ${on} }); return true;`);
  const expect = (ok, detail) => {
    if (!ok) throw new Error(JSON.stringify(detail));
    return detail;
  };
  for (let i = 0; i < 60 && !(await ac(`return ac.store.getState().tabs.t2?.title === "plain";`)); i++) await sleep(500);
  await sleep(500);

  await rep.check("the app's Metadata.appintents lists the six actions, both entities and the destination", async () => {
    const meta = JSON.parse(readFileSync(join(resolve(appArg), "Contents/Resources/Metadata.appintents/extract.actionsdata"), "utf8"));
    const actions = Object.keys(meta.actions).sort();
    const want = ["CloseTabsIntent", "CopyCleanLinkIntent", "GetOpenTabsIntent", "NewTabIntent", "OpenURLIntent", "SwitchToTabIntent"];
    const text = JSON.stringify(meta);
    return expect(JSON.stringify(actions) === JSON.stringify(want) && ["TabEntity", "ProfileEntity", "LinkDestination"].every((name) => text.includes(name)), actions);
  });

  await rep.check("an action name the harness doesn't know fails instead of passing as a no-op", async () => {
    const r = await run("closeTab");
    return expect(!r.ok && r.error === "No intent named closeTab.", r);
  });

  await rep.check("Get Open Tabs lists the window's tabs with their profile; Work has none yet", async () => {
    const all = await run("getOpenTabs");
    const work = await run("getOpenTabs", { profileId: "work" });
    return expect(all.ok && all.value.some((t) => t.id === "t2" && t.profile === "Personal") && work.ok && work.value.length === 0, { all, work });
  });

  await rep.check("Open URL in Work opens a Work tab", async () => {
    await littleArdiaSetting(false);
    const r = await run("openURL", { url: page("work"), profileId: "work" });
    const t = await opened(page("work"));
    return expect(r.ok && t.profileId === "work" && !t.small, { r, t });
  });

  await rep.check("New Tab in Profile opens a Work tab in the window links would use, and focuses it", async () => {
    const r = await run("newTab", { profileId: "work" });
    const t = r.ok && (await ac(`const s = ac.store.getState(); const t = s.tabs[${JSON.stringify(r.value?.id)}]; return t ? { profileId: t.profileId, windows: s.windowOrder.length, focused: s.ui.focusOrder[0] === t.windowId, small: s.windows[t.windowId].kind === "small" } : null;`));
    return expect(r.ok && r.value.profile === "Work" && t?.profileId === "work" && t.focused && !t.small && t.windows === 1, { r, t });
  });

  await rep.check("Get Open Tabs still lists Personal's tabs while the window shows Work", async () => {
    const all = await run("getOpenTabs");
    return expect(all.ok && all.value.some((t) => t.id === "t1" && t.profile === "Personal"), all);
  });

  await rep.check("Open URL in Little Ardia opens it there with the setting off", async () => {
    const r = await run("openURL", { url: page("little"), destination: "littleArdia" });
    return expect(r.ok && (await opened(page("little"))).small, r);
  });

  await rep.check("Open URL with nothing picked goes where links from other apps go; A Tab overrides it", async () => {
    await littleArdiaSetting(true);
    await run("openURL", { url: page("routed") });
    await run("openURL", { url: page("tab"), destination: "tab" });
    const routed = await opened(page("routed"));
    const tab = await opened(page("tab"));
    await littleArdiaSetting(false);
    return expect(routed.small && !tab.small, { routed, tab });
  });

  await rep.check("a deleted profile doesn't resolve", async () => {
    const r = await run("openURL", { url: page("gone"), profileId: "deleted" });
    return expect(!r.ok && r.unresolved, r);
  });

  await rep.check("Switch to Tab shows it, in its own profile, in the focused window", async () => {
    const r = await run("switchToTab", { tabId: "t2" });
    await sleep(300);
    const t = await tabAt(page("plain"));
    const active = await ac(`const s = ac.store.getState(); return JSON.stringify(s.windows[${JSON.stringify(t.windowId)}].activeTabIds);`);
    return expect(r.ok && t.focused && t.windowProfile === "default" && active.includes('"t2"'), { r, t, active });
  });

  await rep.check("Copy Clean Link copies the front tab's link without its tracker", async () => {
    await run("switchToTab", { tabId: "t1" });
    await sleep(300);
    const r = await run("copyCleanLink");
    return expect(r.ok && r.value === page("tracked?id=7"), r);
  });

  await rep.check("a private window: its tabs never show up, and Copy Clean Link won't copy from it", async () => {
    const id = await ac(`return ac.store.getState().createWindow({ incognito: true, url: ${JSON.stringify(page("private"))} });`);
    await opened(page("private"));
    await ac(`ac.actions.focus(${JSON.stringify(id)}); return true;`);
    await sleep(600);
    const all = await run("getOpenTabs");
    const copied = await run("copyCleanLink");
    await ac(`ac.store.getState().closeWindow(${JSON.stringify(id)}); return true;`);
    return expect(all.ok && !all.value.some((t) => t.url === page("private")) && !copied.ok && /private/.test(copied.error), { all: all.value?.map((t) => t.url), copied });
  });

  await rep.check("Close Tabs with a tab closed since Shortcuts resolved it says so and closes none", async () => {
    const work = await tabAt(page("work"));
    const tab = await tabAt(page("tab"));
    const r = await run("closeTabs", { tabIds: [tab.id, work.id], closedSinceResolving: [work.id] });
    await sleep(400);
    return expect(!r.ok && r.error === "That tab is closed." && !!(await tabAt(page("tab"))), r);
  });

  await rep.check("Switch to Tab on a tab closed since Shortcuts resolved it says so", async () => {
    const routed = await tabAt(page("routed"));
    const r = await run("switchToTab", { tabId: routed.id, closedSinceResolving: [routed.id] });
    return expect(!r.ok && r.error === "That tab is closed.", r);
  });

  await rep.check("Close Tabs closes it, and its id then resolves to nothing", async () => {
    const t = await tabAt(page("tab"));
    const r = await run("closeTabs", { tabIds: [t.id] });
    await sleep(400);
    const stale = await run("switchToTab", { tabId: t.id });
    return expect(r.ok && !(await tabAt(page("tab"))) && !stale.ok && stale.unresolved, { r, stale });
  });
} catch (error) {
  rep.record("setup", { error });
} finally {
  await app?.quit();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);
