import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { FIXTURE_NAME, prepareExtension } from "./f09-extensions.mjs";

const COOKIE = "ardia_w70";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const writeMarks = (session, value) => evaluate(session, `(() => { document.cookie = ${js(`${COOKIE}=${value}; max-age=3600; path=/`)}; localStorage.setItem('w70', ${js(value)}); return true; })()`);
const readMarks = (session) => evaluate(session, `({ cookie: document.cookie.split('; ').find(c => c.startsWith(${js(`${COOKIE}=`)}))?.split('=')[1] ?? null, storage: localStorage.getItem('w70') })`);

async function pageIn(app, url) {
  const target = await app.pageLoaded(url, { timeout: 30000 });
  const info = (await app.browserTargets()).find((candidate) => candidate.targetId === target.id);
  const { windowId } = await app.browser.send("Browser.getWindowForTarget", { targetId: target.id });
  return { target, session: await app.connect(target), context: info?.browserContextId ?? null, nativeWindow: windowId };
}

async function openTab(app, shell, url, profileId) {
  const tabId = await shell.state(`return s.newTab(windowId, { url: ${js(url)}${profileId ? `, profileId: ${js(profileId)}` : ""} });`);
  if (typeof tabId !== "string") throw new Error(`newTab returned ${JSON.stringify(tabId)}`);
  await shell.waitTabUrl(tabId, (current) => current === url, { timeout: 30000, label: `${url} in ${shell.windowId}` });
  return { tabId, ...(await pageIn(app, url)) };
}

async function switchTo(shell, profileId) {
  await shell.state(`s.switchProfile(windowId, ${js(profileId)}); return true;`);
  return shell.waitState(`return s.windows[windowId]?.profileId === ${js(profileId)} || null;`, { label: `the window on ${profileId}` });
}

async function windowGone(app, nativeWindow) {
  return until(async () => {
    const reply = await app.browser.send("Browser.getWindowBounds", { windowId: nativeWindow }).then(() => true, () => false);
    return !reply;
  }, { timeout: 20000, label: `native browser window ${nativeWindow} to close` });
}

export const w70 = {
  id: "W70",
  issue: 70,
  title: "Every regular profile pages in place in one window, each tab in its own engine profile, with extensions kept per engine profile",
  deadline: 900000,
  manual: [
    { name: "Swiping toward an isolated profile", steps: ["Create an isolated profile (its own data) and a shared-data profile.", "In one window, swipe with two fingers toward each: the sidebar pages in place to that profile's tabs and no other window appears."], reason: "needs trackpad gestures" },
  ],
  async run(t) {
    await paging(t);
    await extensionsPerProfile(t);
    await closingFamilies(t);
  },
};

async function paging(t) {
  const run = nonce("w70");
  let state = await startBrowser(t, { name: "paging" });
  const url = (label) => `${t.fixtures.url.isolation("isolation.ardia.test")}?p=${label}-${run}`;
  let profiles;
  let home;
  let windows;
  await t.check("the default profile's page stores its own cookie and localStorage", async () => {
    profiles = await state.shell.state("return { work: s.createProfile({ name: 'Work' }), side: s.createProfile({ name: 'Side', shareWith: 'default' }) };");
    home = await openTab(state.app, state.shell, url("default"));
    await writeMarks(home.session, `default-${run}`);
    windows = await state.shell.windowIds();
    return { profiles, context: home.context, nativeWindow: home.nativeWindow, windows };
  }, { critical: true });

  let isolated;
  await t.check("switching to an isolated profile pages in place: no window opens and its tab runs in that profile's own browser context", async () => {
    await switchTo(state.shell, profiles.work);
    isolated = await openTab(state.app, state.shell, url("isolated"));
    const after = await state.shell.windowIds();
    if (JSON.stringify(after) !== JSON.stringify(windows)) throw new Error(`native windows went from ${JSON.stringify(windows)} to ${JSON.stringify(after)}`);
    if (!isolated.context || isolated.context === home.context) throw new Error(`the isolated tab runs in ${isolated.context}, the default tab in ${home.context}`);
    if (isolated.nativeWindow === home.nativeWindow) throw new Error("the isolated tab sits in the default profile's Browser");
    const tab = await state.shell.tab(isolated.tabId);
    if (tab.windowId !== state.shell.windowId || tab.profileId !== profiles.work) throw new Error(`the isolated tab is ${JSON.stringify({ windowId: tab.windowId, profileId: tab.profileId })}`);
    return { windows: after, context: isolated.context, companion: isolated.nativeWindow };
  }, { critical: true });

  await t.check("the isolated profile sees none of the default profile's cookies or storage, and its own writes stay there", async () => {
    const marks = await readMarks(isolated.session);
    if (marks.cookie || marks.storage) throw new Error(`the isolated page reads ${JSON.stringify(marks)}`);
    await writeMarks(isolated.session, `isolated-${run}`);
    const back = await readMarks(home.session);
    if (back.cookie !== `default-${run}` || back.storage !== `default-${run}`) throw new Error(`the default page now reads ${JSON.stringify(back)}`);
    return { isolated: await readMarks(isolated.session), default: back };
  });

  await t.check("switching back shows the default profile's tab, still in its own context", async () => {
    await switchTo(state.shell, "default");
    const marks = await readMarks(home.session);
    if (marks.cookie !== `default-${run}`) throw new Error(`the default page reads ${JSON.stringify(marks)}`);
    const after = await state.shell.windowIds();
    if (after.length !== windows.length) throw new Error(`native windows ${JSON.stringify(after)}`);
    return { marks };
  });

  await t.check("a profile sharing the default profile's data pages in place into the same Browser and context", async () => {
    await switchTo(state.shell, profiles.side);
    const shared = await openTab(state.app, state.shell, url("shared"));
    const marks = await readMarks(shared.session);
    if (shared.context !== home.context) throw new Error(`the shared profile runs in ${shared.context}`);
    if (shared.nativeWindow !== home.nativeWindow) throw new Error("a profile sharing the default data got a Browser of its own");
    if (marks.cookie !== `default-${run}`) throw new Error(`the shared profile reads ${JSON.stringify(marks)}`);
    await switchTo(state.shell, "default");
    return { context: shared.context, marks };
  });

  await t.check("moving a tab to the isolated profile keeps it in this window and reloads it in the isolated context", async () => {
    const moving = await openTab(state.app, state.shell, url("move"));
    if (moving.context !== home.context) throw new Error(`the tab to move started in ${moving.context}`);
    await state.shell.state(`s.moveTabToProfile(${js(moving.tabId)}, ${js(profiles.work)}); return true;`);
    const moved = await until(async () => {
      const targets = (await state.app.browserTargets()).filter((target) => target.type === "page" && target.url === url("move"));
      return targets.length === 1 && targets[0].browserContextId === isolated.context ? targets[0] : false;
    }, { timeout: 30000, label: "the moved page to run only in the isolated context" });
    const tab = await state.shell.tab(moving.tabId);
    if (!tab || tab.windowId !== state.shell.windowId || tab.profileId !== profiles.work) throw new Error(`the moved tab is ${JSON.stringify(tab && { windowId: tab.windowId, profileId: tab.profileId })}`);
    const after = await state.shell.windowIds();
    if (after.length !== windows.length) throw new Error(`native windows ${JSON.stringify(after)}`);
    return { target: moved.targetId, context: moved.browserContextId };
  });

  await t.check("closing a window that holds tabs of two engine profiles closes its hidden isolated-profile Browser too", async () => {
    const second = await state.shell.state("return s.createWindow({});");
    await until(async () => (await state.shell.windowIds()).includes(second), { timeout: 20000, label: "the second native window" });
    const other = await state.app.shell(second, { timeout: 25000 });
    await openTab(state.app, other, url("second-default"));
    await switchTo(other, profiles.work);
    const work = await openTab(state.app, other, url("second-isolated"));
    if (work.nativeWindow === isolated.nativeWindow) throw new Error("two windows share one isolated-profile Browser");
    await other.state("s.closeWindow(windowId); return true;").catch(() => {});
    await until(async () => !(await state.shell.windowIds()).includes(second), { timeout: 20000, label: "the second window to close" });
    await windowGone(state.app, work.nativeWindow);
    const left = (await state.app.browserTargets()).filter((target) => target.type === "page" && target.url.includes(`second-`));
    if (left.length) throw new Error(`pages of the closed window survive: ${left.map((target) => target.url).join(", ")}`);
    const still = await readMarks(isolated.session);
    if (still.cookie !== `isolated-${run}`) throw new Error(`the first window's isolated tab reads ${JSON.stringify(still)}`);
    return { closedCompanion: work.nativeWindow };
  });

  await t.check("after a restart the window restores both profiles' tabs, each in its own profile", async () => {
    await delay(2500);
    state = await restartBrowser(t, state);
    const tabs = await state.shell.state(`const w = s.windows[windowId]; return (w?.tabIds ?? []).map((id) => ({ id, url: s.tabs[id]?.url, profileId: s.tabs[id]?.profileId }));`);
    const restored = tabs.find((tab) => tab.url === url("isolated"));
    if (!restored || restored.profileId !== profiles.work) throw new Error(`restored tabs ${JSON.stringify(tabs)}`);
    if (!tabs.some((tab) => tab.url === url("default") && tab.profileId === "default")) throw new Error(`the default tab is missing from ${JSON.stringify(tabs)}`);
    await switchTo(state.shell, profiles.work);
    await state.shell.state(`s.activate(${js(restored.id)}); return true;`);
    const page = await pageIn(state.app, url("isolated"));
    const marks = await readMarks(page.session);
    const regular = (await state.app.browserTargets()).find((target) => target.type === "page" && target.url === url("default"));
    if (regular && regular.browserContextId === page.context) throw new Error("after restart the isolated tab runs in the default context");
    if (marks.cookie !== `isolated-${run}`) throw new Error(`the restored isolated tab reads ${JSON.stringify(marks)}`);
    return { tabs: tabs.length, context: page.context, marks };
  });
  await t.stop(state.app);
}

async function contentScriptFixture(dir) {
  await prepareExtension(dir);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  manifest.content_scripts = [{ matches: ["http://isolation.ardia.test/*"], js: ["mark.js"], run_at: "document_end" }];
  manifest.host_permissions = ["http://isolation.ardia.test/*"];
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), "sessions"])];
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, "mark.js"), "document.documentElement.dataset.ardiaFixture = chrome.runtime.id;\n");
  return dir;
}

export { contentScriptFixture, installed, workerOf, openTab, switchTo };

async function installed(shell, path, profile) {
  const reply = await shell.call("extensions.install", { path }, profile);
  if (!reply.ok) throw new Error(`installing into ${JSON.stringify(profile)} failed: ${reply.code} ${reply.message}`);
  return reply.value.id;
}

async function workerOf(app, id, context) {
  const target = await until(async () => {
    const infos = await app.browserTargets();
    const info = infos.find((candidate) => candidate.type === "service_worker" && candidate.url.startsWith(`chrome-extension://${id}/`) &&
      (!context || candidate.browserContextId === context));
    if (!info) return false;
    return (await app.targets()).find((candidate) => candidate.id === info.targetId) ?? false;
  }, { timeout: 30000, label: `the service worker of ${id}` });
  return app.connect(target);
}

const marked = (session) => evaluate(session, "document.documentElement.dataset.ardiaFixture ?? null");

async function extensionsPerProfile(t) {
  const run = nonce("w70e");
  const state = await startBrowser(t, { name: "paging-extensions", extensions: true });
  const { app, shell } = state;
  const url = (label) => `${t.fixtures.url.isolation("isolation.ardia.test")}?p=${label}-${run}`;
  const fixture = await contentScriptFixture(await t.scratch("profile-fixture"));
  let profiles;
  let pages;
  let workId;
  await t.check("an extension installed only in the isolated profile runs on its pages and nowhere else", async () => {
    profiles = await shell.state("return { work: s.createProfile({ name: 'Work' }), side: s.createProfile({ name: 'Side', shareWith: 'default' }) };");
    const home = await openTab(app, shell, url("home"));
    await switchTo(shell, profiles.work);
    const first = await openTab(app, shell, url("work-first"));
    workId = await installed(shell, fixture, profiles.work);
    const work = await openTab(app, shell, url("work"));
    await switchTo(shell, "default");
    const other = await openTab(app, shell, url("other"));
    pages = { home, work, other, first };
    const ran = await until(() => marked(work.session), { timeout: 15000, label: "the content script on the isolated page" });
    const leaked = { home: await marked(home.session), other: await marked(other.session) };
    if (leaked.home || leaked.other) throw new Error(`the isolated profile's content script ran on default pages: ${JSON.stringify(leaked)}`);
    const regularList = await shell.call("extensions.list", {});
    if ((regularList.value?.extensions ?? []).some((x) => x.name === FIXTURE_NAME)) throw new Error("the default profile lists the isolated profile's extension");
    return { workId, ran, leaked };
  }, { critical: true });

  await t.check("the toolbar follows the window's engine profile", async () => {
    const pinned = await shell.call("extensions.configure", { id: workId, options: { pinned: true } }, profiles.work);
    if (!pinned.ok) throw new Error(`pinning failed: ${pinned.code} ${pinned.message}`);
    await switchTo(shell, profiles.work);
    const shown = await until(async () => (await shell.labels()).includes("Fixture Action") || false, { timeout: 15000, label: "the isolated profile's action on the toolbar" });
    await switchTo(shell, "default");
    await delay(1500);
    if ((await shell.labels()).includes("Fixture Action")) throw new Error("the default profile's toolbar shows the isolated profile's extension");
    await switchTo(shell, profiles.side);
    await delay(1000);
    if ((await shell.labels()).includes("Fixture Action")) throw new Error("a profile sharing the default data shows the isolated profile's extension");
    await switchTo(shell, "default");
    return { shown };
  });

  await t.check("the isolated profile's extension queries only its own profile's tabs, and its current window never surfaces a hidden window", async () => {
    const windowsBefore = await shell.windowIds();
    const sw = await workerOf(app, workId);
    const all = await evaluate(sw, "chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.url))");
    const foreign = all.filter((tabUrl) => tabUrl.includes(`home-${run}`) || tabUrl.includes(`other-${run}`));
    if (foreign.length) throw new Error(`the isolated extension sees default tabs: ${foreign.join(", ")}`);
    if (!all.some((tabUrl) => tabUrl.includes(`work-${run}`))) throw new Error(`the isolated extension misses its own tab: ${JSON.stringify(all)}`);
    await switchTo(shell, profiles.work);
    const current = await evaluate(sw, "chrome.windows.getLastFocused({ populate: true }).then((w) => ({ id: w.id, urls: w.tabs.map((tab) => tab.url) })).catch((error) => ({ error: String(error) }))");
    const currentTabs = await evaluate(sw, "chrome.tabs.query({ lastFocusedWindow: true }).then((tabs) => tabs.map((tab) => tab.url))");
    if (current.error) throw new Error(`windows.getLastFocused failed: ${current.error}`);
    if (current.urls.some((tabUrl) => tabUrl.includes(`home-${run}`) || tabUrl.includes(`other-${run}`))) throw new Error(`the extension's window lists default tabs: ${JSON.stringify(current)}`);
    if (currentTabs.some((tabUrl) => tabUrl.includes(`home-${run}`) || tabUrl.includes(`other-${run}`))) throw new Error(`lastFocusedWindow tabs include default tabs: ${JSON.stringify(currentTabs)}`);
    const updates = {};
    for (const [name, change] of Object.entries({ focused: { focused: true, drawAttention: true }, minimized: { state: "minimized" }, maximized: { state: "maximized" }, normal: { state: "normal" } })) {
      updates[name] = await evaluate(sw, `chrome.windows.update(${current.id}, ${JSON.stringify(change)}).then((w) => ({ id: w.id, state: w.state })).catch((error) => ({ error: String(error) }))`);
      if (updates[name].error || updates[name].id !== current.id) throw new Error(`windows.update ${name} on the isolated profile's window: ${JSON.stringify(updates[name])}`);
    }
    await evaluate(sw, `chrome.tabs.create({ windowId: ${current.id}, url: ${js(url("from-extension"))}, active: false }).then(() => true)`);
    const adopted = await shell.waitState(`return Object.values(s.tabs).find((tab) => tab.url === ${js(url("from-extension"))}) ?? null;`, { timeout: 20000, label: "the extension's tab in this window" });
    if (adopted.windowId !== shell.windowId || adopted.profileId !== profiles.work) throw new Error(`the extension's tab landed as ${JSON.stringify({ windowId: adopted.windowId, profileId: adopted.profileId })}`);
    const windowsAfter = await shell.windowIds();
    if (JSON.stringify(windowsAfter) !== JSON.stringify(windowsBefore)) throw new Error(`windows changed from ${JSON.stringify(windowsBefore)} to ${JSON.stringify(windowsAfter)}`);
    const { bounds } = await app.browser.send("Browser.getWindowBounds", { windowId: current.id });
    await switchTo(shell, "default");
    return { tabs: all.length, current: current.id, companionState: bounds.windowState, adopted: adopted.id, updates };
  });

  await t.check("an extension of the default profile is shared by the profile sharing its data and sees both profiles' tabs, with no Browser of their own", async () => {
    const copy = await contentScriptFixture(await t.scratch("shared-fixture"));
    const sharedId = await installed(shell, copy, "");
    await switchTo(shell, profiles.side);
    const shared = await openTab(app, shell, url("side"));
    if (shared.nativeWindow !== pages.home.nativeWindow) throw new Error("the sharing profile's tab got a Browser of its own");
    const sw = await workerOf(app, sharedId, pages.home.context);
    const all = await evaluate(sw, "chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.url))");
    for (const label of ["home", "other", "side"]) {
      if (!all.some((tabUrl) => tabUrl.includes(`${label}-${run}`))) throw new Error(`the shared extension misses the ${label} tab: ${JSON.stringify(all)}`);
    }
    if (all.some((tabUrl) => tabUrl.includes(`work-${run}`))) throw new Error(`the shared extension sees the isolated profile's tab: ${JSON.stringify(all)}`);
    const ran = await until(() => marked(shared.session), { timeout: 15000, label: "the shared extension's content script on the sharing profile's page" });
    if (ran !== sharedId) throw new Error(`the sharing profile's page was marked by ${ran}`);
    await switchTo(shell, "default");
    return { sharedId, tabs: all.length };
  });
  await t.stop(app);
}

const popupFor = (id, profile) => ({ kind: "popup", url: `chrome-extension://${id}/popup.html`, profile });

async function reloaded(app, shell) {
  await shell.eval("globalThis.__w70Reloading = true");
  await shell.session.send("Page.reload");
  await delay(1500);
  return until(async () => {
    const next = await app.shell(shell.windowId, { timeout: 5000 }).catch(() => null);
    if (!next) return false;
    const fresh = await next.eval("globalThis.__w70Reloading === undefined && !!document.querySelector('[data-ardia-linux-window]')").catch(() => false);
    return fresh ? next : false;
  }, { timeout: 25000, label: "the reloaded shell" });
}

async function popupOpens(shell, id, profile) {
  const view = await shell.invoke("extensionView.create", popupFor(id, profile));
  if (view.ok) await shell.invoke("extensionView.release", { id: view.value.id });
  return view;
}

async function recentlyClosed(app, shell, id, profile, run, label) {
  const page = await openTab(app, shell, `chrome-extension://${id}/opened.html#${label}-${run}`, profile);
  const entries = await evaluate(page.session, "chrome.sessions.getRecentlyClosed().then((items) => items.map((item) => item.window ? { window: item.window.tabs.map((tab) => tab.url) } : { tab: item.tab?.url ?? null }))");
  await shell.state(`s.closeTabs([${js(page.tabId)}]); return true;`);
  return entries;
}

const UNLOAD_PAGE = "/w70-unload";
const BEACON = "/w70-beacon";

async function closingFamilies(t) {
  const run = nonce("w70c");
  t.fixtures.route(UNLOAD_PAGE, ({ url, html }) => html("Unload fixture", `<h1>Unload ${url.searchParams.get("who") ?? ""}</h1><script>
    const who = ${JSON.stringify("")} + new URLSearchParams(location.search).get("who");
    addEventListener("pagehide", () => navigator.sendBeacon("${BEACON}?event=pagehide&who=" + who));
    addEventListener("unload", () => {
      navigator.sendBeacon("${BEACON}?event=unload&who=" + who);
      const until = performance.now() + 200;
      while (performance.now() < until) {}
      navigator.sendBeacon("${BEACON}?event=late&who=" + who);
    });
  </script>`));
  t.fixtures.route(BEACON, ({ send }) => send(204, "text/plain", ""));
  const isolation = (label) => `${t.fixtures.url.isolation("isolation.ardia.test")}?p=${label}-${run}`;
  const unloadUrl = (who) => `http://isolation.ardia.test:${t.fixtures.ports.http}${UNLOAD_PAGE}?who=${who}-${run}`;
  const beacons = (who) => t.fixtures.requests.filter((request) => request.path === BEACON && request.query.who === `${who}-${run}`).map((request) => request.query.event);
  const quiet = "s.updateSettings({ warnBeforeClosingWindow: false, warnBeforeClosingLastTab: false }); return true;";
  let state = await startBrowser(t, { name: "paging-close", extensions: true });
  await state.shell.state(quiet);
  const profiles = await state.shell.state("return { work: s.createProfile({ name: 'Work' }) };");
  const fixture = await contentScriptFixture(await t.scratch("close-fixture"));
  const workId = await installed(state.shell, fixture, profiles.work);

  await t.check("after the shell reloads, the window still follows its engine profile, and a selection the old shell left pending can't win", async () => {
    for (let round = 0; round < 3; round++) {
      await switchTo(state.shell, profiles.work);
      await switchTo(state.shell, "default");
    }
    await switchTo(state.shell, profiles.work);
    await openTab(state.app, state.shell, isolation("reload-work"));
    const before = await popupOpens(state.shell, workId, profiles.work);
    if (!before.ok) throw new Error(`the popup didn't open before the reload: ${before.code} ${before.message}`);
    const late = await state.shell.state("return s.createProfile({ name: 'Late' });");
    await state.shell.eval("globalThis.__w70Renderer = 'old', true");
    await state.shell.eval(`(__ardiaHost.invoke("ArdiaShell.setActiveProfile", { args: [${js(late)}, 1000] }).catch(() => null), true)`);
    state.shell = await reloaded(state.app, state.shell);
    const fresh = await state.shell.eval("globalThis.__w70Renderer === undefined");
    if (!fresh) throw new Error("the shell did not reload");
    await switchTo(state.shell, profiles.work);
    const selected = await state.shell.invoke("ArdiaShell.setActiveProfile", { args: [profiles.work, 50] });
    if (!selected.ok || selected.value !== true) throw new Error(`the reloaded shell's selection was refused: ${JSON.stringify(selected)}`);
    await delay(3000);
    const after = await popupOpens(state.shell, workId, profiles.work);
    if (!after.ok) throw new Error(`after the reload the window no longer follows the isolated profile: ${after.code} ${after.message}`);
    await switchTo(state.shell, "default");
    return { before: before.value.id, selected: selected.value, after: after.value.id };
  });

  await t.check("closing a window runs the unload handlers of its isolated-profile tabs and records no hidden window in that profile's recently closed", async () => {
    const second = await state.shell.state("return s.createWindow({});");
    await until(async () => (await state.shell.windowIds()).includes(second), { timeout: 20000, label: "the second native window" });
    const other = await state.app.shell(second, { timeout: 25000 });
    await openTab(state.app, other, unloadUrl("default"));
    await switchTo(other, profiles.work);
    await openTab(state.app, other, unloadUrl("isolated"));
    await openTab(state.app, other, isolation("second-isolated"));
    const request = await state.shell.invoke("ArdiaShell.closeWindow", { args: [second] });
    if (!request.ok) throw new Error(`the native close request was refused: ${request.code} ${request.message}`);
    await until(async () => !(await state.shell.windowIds()).includes(second), { timeout: 20000, label: "the second window to close" });
    const expected = ["pagehide", "unload", "late"];
    const complete = (who) => expected.every((event) => beacons(who).includes(event));
    const fired = await until(async () => (complete("default") && complete("isolated") ? { default: beacons("default"), isolated: beacons("isolated") } : false),
      { timeout: 10000, label: "pagehide, unload and the late unload beacon from both profiles' tabs" }).catch(() => ({ default: beacons("default"), isolated: beacons("isolated") }));
    for (const who of ["default", "isolated"]) {
      const missing = expected.filter((event) => !fired[who].includes(event));
      if (missing.length) throw new Error(`the ${who} tab's unload sequence didn't complete (missing ${missing.join(", ")}): ${JSON.stringify(fired)}`);
    }
    await switchTo(state.shell, profiles.work);
    const entries = await recentlyClosed(state.app, state.shell, workId, profiles.work, run, "window-close");
    const hidden = entries.filter((entry) => entry.window);
    if (hidden.length) throw new Error(`the isolated profile's recently closed holds a hidden window: ${JSON.stringify(hidden)}`);
    await switchTo(state.shell, "default");
    return { fired, entries };
  });

  await t.check("after quitting, the isolated profile's recently closed holds no hidden window", async () => {
    await switchTo(state.shell, profiles.work);
    await openTab(state.app, state.shell, isolation("quit-isolated"));
    await switchTo(state.shell, "default");
    await delay(2500);
    state = await restartBrowser(t, state, { extensions: true });
    await switchTo(state.shell, profiles.work);
    const entries = await recentlyClosed(state.app, state.shell, workId, profiles.work, run, "after-quit");
    const hidden = entries.filter((entry) => entry.window);
    if (hidden.length) throw new Error(`after quitting the isolated profile's recently closed holds a hidden window: ${JSON.stringify(hidden)}`);
    await switchTo(state.shell, "default");
    return { entries };
  });

  await t.check("a finished download of the isolated profile can be checked and shown from the window", async () => {
    await switchTo(state.shell, profiles.work);
    const page = await openTab(state.app, state.shell, isolation("download-work"));
    const name = `w70-isolated-${run}.bin`;
    await state.shell.navigate(page.tabId, t.fixtures.url.download(name, 4096));
    const download = await until(async () => (await state.shell.state("return s.downloads ?? [];")).find((d) => d.filename?.endsWith(name) && d.state === "finished" && d.path) ?? false,
      { timeout: 30000, label: "the isolated profile's download to finish" }).catch(async (error) => {
      throw new Error(`${error.message}; downloads ${JSON.stringify(await state.shell.state("return (s.downloads ?? []).map((d) => ({ filename: d.filename, state: d.state, path: d.path, profile: d.profile }));"))}`);
    });
    const status = await state.shell.invoke("ArdiaSystem.fileStatus", { args: [[download.path]] });
    const icon = await state.shell.invoke("ArdiaSystem.fileIcon", { args: [download.path, 32] });
    await switchTo(state.shell, "default");
    if (!status.ok || status.value?.[0] !== true) throw new Error(`fileStatus for the isolated download: ${JSON.stringify(status)}`);
    if (!icon.ok) throw new Error(`fileIcon for the isolated download: ${icon.code} ${icon.message}`);
    return { path: download.path, status: status.value };
  });
  await t.stop(state.app);

  await t.check("closing the only window during a download warns, whichever profiles its tabs use", async () => {
    const outcomes = {};
    for (const [label, companion, downloading] of [["no-download", true, false], ["control", false, true], ["with-companion", true, true]]) {
      const running = await startBrowser(t, { name: `paging-download-${label}` });
      await running.shell.state(quiet);
      const work = companion ? await running.shell.state("return s.createProfile({ name: 'Work' });") : null;
      if (work) {
        await switchTo(running.shell, work);
        await openTab(running.app, running.shell, isolation(`download-${label}`));
        await switchTo(running.shell, "default");
      }
      const page = await openTab(running.app, running.shell, isolation(`slow-${label}`));
      const name = `w70-slow-${label}-${run}.bin`;
      if (downloading) {
        await running.shell.navigate(page.tabId, t.fixtures.url.slow(name, 8 << 20));
        await until(async () => (await running.shell.state("return s.downloads ?? [];")).find((d) => d.filename?.endsWith(name) && d.state === "downloading" && d.received > 0) ?? false,
          { timeout: 30000, label: `the ${label} download to start` });
      }
      const request = await running.shell.invoke("ArdiaShell.closeWindow", { args: [running.shell.windowId] });
      await until(() => running.app.exited || false, { timeout: 8000, label: `${label} to quit` }).catch(() => null);
      const shown = running.app.exited ? null : await running.shell.windowIds().catch(() => null);
      outcomes[label] = { request: request.ok, exited: !!running.app.exited, windows: shown };
      t.fixtures.release(name);
      await t.stop(running.app);
    }
    if (!outcomes["no-download"].exited) throw new Error(`closing the only window without a download didn't quit, so the check can't tell: ${JSON.stringify(outcomes)}`);
    for (const [label, outcome] of Object.entries(outcomes)) {
      if (!outcome.request) throw new Error(`the ${label} close request was refused: ${JSON.stringify(outcomes)}`);
    }
    const kept = (outcome) => !outcome.exited && Array.isArray(outcome.windows) && outcome.windows.includes("main");
    if (!kept(outcomes.control)) throw new Error(`without a companion the window closed without the download warning: ${JSON.stringify(outcomes)}`);
    if (!kept(outcomes["with-companion"])) throw new Error(`with an isolated-profile tab the only window closed without the download warning: ${JSON.stringify(outcomes)}`);
    return outcomes;
  });
}
