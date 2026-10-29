import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { startPortal } from "../lib/desktopServices.mjs";
import { currentRect, desktopShot, desktopUnavailable, hasFocus, openDesktop, promptAfter, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { chooseMenuItem, clickNeutral, openDownloadsPopover, pageMenuIndex, everyWindowIsArdia, labelRect, openedWindow, pagePoint, rightClickMenu, shellLines } from "../lib/desktopUi.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const OPEN_LINK_IN_INCOGNITO = 4;
const exists = (path) => stat(path).then(() => true, () => false);

async function liveShells(app) {
  return (await app.shells()).filter((s) => s.ready).map((s) => s.windowId);
}

async function windowFor(desktop, title, { timeout = 15000 } = {}) {
  return until(async () => (await desktop.windows()).find((w) => w.title.includes(title)) ?? false, { timeout, label: `a compositor window titled ${title}` });
}

async function shellWindow(desktop, shell, { timeout = 15000 } = {}) {
  const title = await until(async () => {
    const tab = await shell.activeTabId();
    const t = tab ? (await shell.tab(tab))?.title : null;
    return t || false;
  }, { timeout, label: `${shell.windowId}'s tab title` });
  return windowFor(desktop, title, { timeout });
}

async function focusInto(desktop, window, shell) {
  const focused = await desktop.focused();
  if (focused?.id !== window.id) await desktop.raise(window);
  await waitFocused(desktop, (w) => w.id === window.id, { label: `${window.title} focused` });
  await clickNeutral(desktop, window, shell);
}

export async function openPrivateByKeys(desktop, app, window, shell) {
  await focusInto(desktop, window, shell);
  const known = await desktop.windows();
  const shells = await liveShells(app);
  await desktop.key("ctrl+shift+n");
  const opened = await openedWindow(desktop, app, known, shells, { label: "the Ctrl+Shift+N window" });
  if (!opened.shell.privateWindow) throw new Error(`Ctrl+Shift+N opened ${opened.shell.windowId}, which is not private`);
  return opened;
}

async function openLinkInIncognito(t, desktop, app, window, shell, url, label) {
  await focusInto(desktop, window, shell);
  const tab = await shell.activeTabId();
  await shell.navigate(tab, url);
  await shell.waitTabUrl(tab, (u) => u === url);
  const page = await app.pageLoaded(url);
  const session = await app.connect(page);
  const link = await pagePoint(desktop, window, shell, session, "#link");
  const href = await evaluate(session, "document.getElementById('link').href", { userGesture: false });
  await desktop.pointerMove(link.x, link.y);
  await delay(400);
  const menu = await rightClickMenu(desktop, link);
  await desktopShot(t, desktop, `${label}-menu`);
  const known = await desktop.windows();
  const shells = await liveShells(app);
  await chooseMenuItem(desktop, OPEN_LINK_IN_INCOGNITO);
  const opened = await openedWindow(desktop, app, known, shells, { label: "the incognito window" });
  const tabUrl = await opened.shell.waitState("const w = s.windows[windowId]; const id = w?.activeTabIds?.[w.profileId]; return s.tabs[id]?.url || null;", { timeout: 15000, label: "the incognito window's tab" });
  await desktopShot(t, desktop, `${label}-opened`);
  return { menu: menu.region, opened, href, tabUrl };
}

export const privateLinkDesktop = {
  id: "F02-71D",
  issue: 71,
  desktop: true,
  title: "Open link in incognito window from a page's native context menu opens an Ardia private window of that window's profile (sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Open link in incognito window", ["Right-click a link and choose Open Link in Incognito Window, in a regular and an isolated window."], missing);
      return;
    }
    const run = nonce("pv71d");
    const desktop = await openDesktop(t);
    const hover = t.fixtures.url.page(1).replace(/\/page\/1.*$/, `/hover?run=${run}`);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "incognito-link", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    let regular;
    await t.check("right-clicking a link and choosing Open link in incognito window opens an Ardia private window on the link, and no other window", async () => {
      const window = await windowFor(desktop, "Acceptance page 1");
      regular = await openLinkInIncognito(t, desktop, app, window, shell, hover, "regular");
      const { opened, href, tabUrl } = regular;
      if (!opened.shell.privateWindow) throw new Error(`${opened.shell.windowId} is not a private window`);
      if (opened.shell.profileId !== "default") throw new Error(`the private window belongs to ${opened.shell.profileId}`);
      if (tabUrl !== href) throw new Error(`the private tab is on ${tabUrl}, not ${href}`);
      return { menu: regular.menu, window: opened.window.title, ...(await everyWindowIsArdia(desktop, app)) };
    }, { critical: true });
    await t.check("a cookie the link's page sets in the private window is absent from the regular window", async () => {
      const privatePage = await app.pageTarget((x) => x.url === regular.href);
      const privateSession = await app.connect(privatePage);
      await evaluate(privateSession, `document.cookie = "pv71d=${run}; path=/"`, { userGesture: false });
      const tab = await shell.activeTabId();
      await shell.navigate(tab, regular.href);
      await shell.waitTabUrl(tab, (u) => u === regular.href);
      const targets = (await app.targets()).filter((x) => x.url === regular.href);
      const cookies = [];
      for (const target of targets) cookies.push(await evaluate(await app.connect(target), "document.cookie", { userGesture: false }).catch(() => null));
      const leaked = cookies.filter((c) => c?.includes(run));
      if (cookies.length < 2) throw new Error(`expected the page in both windows, found ${targets.length}`);
      if (leaked.length !== 1) throw new Error(`the private cookie is in ${leaked.length} of the ${cookies.length} pages`);
      return { pages: cookies.length };
    });
    await t.check("from an isolated profile's window the incognito window belongs to that profile", async () => {
      const work = await shell.state(`return s.createProfile({ name: ${js(`Work ${run}`)} });`);
      const known = await desktop.windows();
      const shells = await liveShells(app);
      await shell.state(`return s.createWindow({ profileId: ${js(work)}, url: ${js(t.fixtures.url.page(2))} });`);
      const isolated = await openedWindow(desktop, app, known, shells, { label: "the isolated window" });
      const window = isolated.window;
      const result = await openLinkInIncognito(t, desktop, app, window, isolated.shell, hover, "isolated");
      if (!result.opened.shell.privateWindow) throw new Error(`${result.opened.shell.windowId} is not private`);
      const owner = await result.opened.shell.state("return s.windows[windowId]?.profileId ?? null;");
      if (result.opened.shell.profileId !== work && !String(owner).includes(work)) throw new Error(`the private window belongs to ${result.opened.shell.profileId} (${owner}), not ${work}`);
      return { profile: result.opened.shell.profileId, owner, ...(await everyWindowIsArdia(desktop, app)) };
    });
    await t.stop(app);
  },
};

const menuRows = (shell) => shell.eval(`[...document.querySelectorAll(".ardia-menu .ardia-menu-item")].map((row) => { const r = row.getBoundingClientRect(); return { title: row.querySelector(".ardia-menu-title")?.textContent ?? row.innerText, checked: row.querySelector(".ardia-menu-check")?.textContent === "✓", x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);

async function openWindowMenu(t, desktop, window, shell, name) {
  const minimize = await labelRect(shell, "Minimize window");
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + minimize.x, frame.y + minimize.y, "right");
  const rows = await until(async () => { const r = await menuRows(shell); return r.length ? r : false; }, { timeout: 8000, label: "the Window menu from the window controls" });
  await desktopShot(t, desktop, name);
  return rows;
}

async function chooseRow(desktop, window, shell, rows, title) {
  const row = rows.find((r) => r.title === title);
  if (!row) throw new Error(`no ${title} in ${JSON.stringify(rows.map((r) => r.title))}`);
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + row.x, frame.y + row.y);
}

export const windowMenuDesktop = {
  id: "F02-148D",
  issue: 148,
  desktop: true,
  title: "Right-clicking the window controls opens the Window menu; it lists regular windows by title and private windows by number, and choosing one focuses it (sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Window menu from the window controls", ["Right-click the window controls of a second window: the Window menu lists the windows; choosing Private Window focuses it."], missing);
      t.manual("Window menu entry", ["The second window's Window menu shows the private window as Private Window; choosing it brings it forward."], missing);
      return;
    }
    const run = nonce("pv148d");
    const desktop = await openDesktop(t);
    const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "second", urls: [t.fixtures.url.storage("second.ardia.test")] }], focused: "main" });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "window-menu", session });
    const second = await app.shell("second", { timeout: 25000 });
    const mainWindow = await windowFor(desktop, "Acceptance page 1");
    const secondWindow = await windowFor(desktop, "Storage fixture");
    const priv = await openPrivateByKeys(desktop, app, mainWindow, shell);
    const secret = t.fixtures.url.page(3, `secret-${run}`);
    const tab = await priv.shell.newTab(secret);
    await priv.shell.waitTabUrl(tab, (u) => u === secret);
    const privWindow = priv.window;
    await focusInto(desktop, privWindow, priv.shell);
    let rows;
    await t.check("right-clicking the second window's controls opens its Window menu with both regular windows by title, this one ticked, and the private window only as Private Window", async () => {
      await focusInto(desktop, secondWindow, second);
      rows = await openWindowMenu(t, desktop, secondWindow, second, "second-window-menu");
      const titles = rows.map((r) => r.title);
      if (!titles.includes("Private Window")) throw new Error(`no Private Window in ${JSON.stringify(titles)}`);
      if (titles.some((x) => x.includes(run) || /Acceptance page 3/.test(x))) throw new Error(`the private window's page reached the menu: ${JSON.stringify(titles)}`);
      const ticked = rows.filter((r) => r.checked);
      if (ticked.length !== 1) throw new Error(`ticks ${JSON.stringify(rows)}`);
      const regular = titles.filter((x) => !["Minimize", "Maximize", "Downloads", "Task Manager", "Merge All Windows", "Private Window"].includes(x));
      if (regular.length !== 2) throw new Error(`regular entries ${JSON.stringify(regular)}`);
      return { titles, ticked: ticked[0].title };
    }, { critical: true });
    await t.check("choosing Private Window with the pointer closes the menu and brings the private window forward with keyboard focus", async () => {
      await chooseRow(desktop, secondWindow, second, rows, "Private Window");
      await waitFocused(desktop, (w) => w.id === privWindow.id, { label: "the private window focused in the compositor" });
      await until(() => hasFocus(priv.shell), { timeout: 8000, label: "document focus in the private window" });
      if ((await menuRows(second)).length) throw new Error("the menu stayed open");
      await desktopShot(t, desktop, "private-chosen");
      return { focused: privWindow.title };
    });
    await t.check("the private window's own Window menu lists the regular windows and itself ticked, and choosing a regular window focuses it", async () => {
      const own = await openWindowMenu(t, desktop, privWindow, priv.shell, "private-window-menu");
      const ticked = own.filter((r) => r.checked);
      if (ticked.length !== 1 || !/Incognito|Private/.test(ticked[0].title)) throw new Error(`ticks ${JSON.stringify(own)}`);
      const target = own.find((r) => !r.checked && r.title.includes("second.ardia.test"));
      if (!target) throw new Error(`no entry for the second window in ${JSON.stringify(own.map((r) => r.title))}`);
      await chooseRow(desktop, privWindow, priv.shell, own, target.title);
      const focused = await waitFocused(desktop, (w) => w.id === secondWindow.id, { label: `${target.title}'s window (${secondWindow.title}) focused` });
      return { titles: own.map((r) => r.title), chose: target.title, focused: focused.title };
    });
    await t.stop(app);
  },
};

async function downloadsPopoverLines(desktop, window, shell) {
  await focusInto(desktop, window, shell);
  const label = await openDownloadsPopover(desktop, window, shell);
  await delay(1500);
  const lines = await shellLines(shell);
  await desktop.key("escape");
  await delay(400);
  return { lines, label };
}

export const privateDownloadsDesktop = {
  id: "F02-72D",
  issue: 72,
  desktop: true,
  title: "A private window's download is listed by the Downloads popover only in that window, and never in the regular window, before or after the private window closes (sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim", "dbusmock", "portal"] });
    if (missing) {
      t.manual("The private window's Downloads popover", ["Download in a private window; Ctrl+J there lists it, Ctrl+J in a regular window does not, before or after the private window closes."], missing);
      return;
    }
    const run = nonce("pv72d");
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const folder = await t.scratch("downloads");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "private-downloads", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }), preferences: { downloads: folder } });
    const mainWindow = await windowFor(desktop, "Acceptance page 1");
    const priv = await openPrivateByKeys(desktop, app, mainWindow, shell);
    const name = `private-${run}.bin`;
    await t.check("a download started in the private window finishes", async () => {
      await portal.pick("SaveFile", [join(folder, name)]);
      const tab = await priv.shell.activeTabId();
      await priv.shell.navigate(tab, t.fixtures.url.download(name, 16384));
      await until(async () => (await readdir(folder)).includes(name), { timeout: 30000, label: `${name} on disk` });
      const asked = (await portal.calls()).some((c) => c.method === "SaveFile");
      return { asked };
    }, { critical: true });
    const privWindow = priv.window;
    await t.check("the downloads popover in the private window lists it", async () => {
      const { lines, label } = await downloadsPopoverLines(desktop, privWindow, priv.shell);
      await desktopShot(t, desktop, "private-popover");
      if (!lines.some((l) => l.includes(name))) throw new Error(`the private popover shows ${JSON.stringify(lines.slice(0, 30))}`);
      return { listed: true, button: label };
    });
    const regularName = `regular-${run}.bin`;
    await t.check("the downloads popover in the regular window lists the regular window's own download and not the private one", async () => {
      await portal.pick("SaveFile", [join(folder, regularName)]);
      await shell.navigate(await shell.activeTabId(), t.fixtures.url.download(regularName, 4096));
      await until(async () => (await readdir(folder)).includes(regularName), { timeout: 30000, label: `${regularName} on disk` });
      const { lines } = await downloadsPopoverLines(desktop, mainWindow, shell);
      await desktopShot(t, desktop, "regular-popover");
      if (!lines.some((l) => l.includes(regularName))) throw new Error(`the regular popover didn't open or doesn't list its own download: ${JSON.stringify(lines.slice(0, 30))}`);
      if (lines.some((l) => l.includes(name))) throw new Error("the regular window lists the private download");
      return { own: regularName };
    });
    await t.check("closing the private window with its close button leaves the regular window's popover without it", async () => {
      await focusInto(desktop, privWindow, priv.shell);
      const close = await labelRect(priv.shell, "Close window");
      const frame = await currentRect(desktop, privWindow);
      await desktop.click(frame.x + close.x, frame.y + close.y);
      await until(async () => !(await liveShells(app)).includes(priv.shell.windowId), { timeout: 15000, label: "the private window to close" });
      const { lines } = await downloadsPopoverLines(desktop, mainWindow, shell);
      if (!lines.some((l) => l.includes(regularName))) throw new Error(`the regular popover didn't open: ${JSON.stringify(lines.slice(0, 30))}`);
      if (lines.some((l) => l.includes(name))) throw new Error("the regular window lists the private download after it closed");
      return { closed: true };
    });
    await t.stop(app);
  },
};

async function printPreview(t, desktop, app, window, shell, label) {
  await focusInto(desktop, window, shell);
  const before = new Set((await app.targets()).map((x) => x.id));
  const { region } = await promptAfter(desktop, () => desktop.key("ctrl+p"), { settle: 4000 });
  const preview = await until(async () => (await app.targets()).find((x) => !before.has(x.id) && x.url.startsWith("chrome://print")) ?? false, { timeout: 15000, label: "a chrome://print preview" });
  await desktopShot(t, desktop, `${label}-print-preview`);
  const frame = await currentRect(desktop, window);
  if (!region || region.width < 300 || region.height < 200) throw new Error(`no print preview on screen: change ${JSON.stringify(region)}`);
  const inside = region.x + region.width / 2 >= frame.x && region.x + region.width / 2 <= frame.x + frame.width;
  if (!inside) throw new Error(`the preview ${JSON.stringify(region)} is not over ${label}'s window ${JSON.stringify(frame)}`);
  await desktop.key("escape");
  await until(async () => !(await app.targets()).some((x) => x.id === preview.id), { timeout: 10000, label: "the preview to close on Escape" });
  return { preview: preview.url, region };
}

async function savePage(t, desktop, app, window, shell, portal, folder, label, title) {
  await focusInto(desktop, window, shell);
  const target = join(folder, `${label}.html`);
  const count = (await portal.calls()).filter((c) => c.method === "SaveFile").length;
  await portal.pick("SaveFile", [target]);
  const url = await shell.state("const w = s.windows[windowId]; return s.tabs[w.activeTabIds[w.profileId]].url;");
  const session = await app.connect(await app.pageTarget((x) => x.url === url));
  const point = await pagePoint(desktop, window, shell, session, "h1");
  await rightClickMenu(desktop, { x: point.x + 200, y: point.y + 120 });
  await desktopShot(t, desktop, `${label}-page-menu`);
  await chooseMenuItem(desktop, await pageMenuIndex(session, "Save as…"));
  const call = await until(async () => (await portal.calls()).filter((c) => c.method === "SaveFile")[count] ?? false, { timeout: 15000, label: "the portal's SaveFile request" });
  await until(() => exists(target), { timeout: 20000, label: `${target} written` });
  const html = await until(async () => { const text = await readFile(target, "utf8"); return text.includes(title) ? text : false; }, { timeout: 10000, label: `the saved page to hold ${title}` });
  return { currentName: call.options.current_name ?? null, bytes: html.length };
}

export const pageCommandsDesktop = {
  id: "F02-101D",
  issue: 101,
  desktop: true,
  title: "Ctrl+P opens the print preview and the page menu's Save as… saves the page through the portal, in an isolated profile's window and in a private window (sway)",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim", "dbusmock", "portal"] });
    if (missing) {
      t.manual("Print and Save Page in isolated and private windows", ["Ctrl+P and Ctrl+S in an isolated window and a private window."], missing);
      return;
    }
    const run = nonce("pv101d");
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const folder = await t.scratch("saved");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "page-commands", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    const mainWindow = await windowFor(desktop, "Acceptance page 1");
    const work = await shell.state(`return s.createProfile({ name: ${js(`Print ${run}`)} });`);
    const known = await desktop.windows();
    const shells = await liveShells(app);
    await shell.state(`return s.createWindow({ profileId: ${js(work)}, url: ${js(t.fixtures.url.page(4, `iso-${run}`))} });`);
    const isolated = await openedWindow(desktop, app, known, shells, { label: "the isolated window" });
    const isolatedWindow = isolated.window;
    await t.check("isolated window: Ctrl+P opens the print preview over it and Escape closes it", async () => printPreview(t, desktop, app, isolatedWindow, isolated.shell, "isolated"));
    await t.check("isolated window: the page menu's Save as… asks the portal where to save and writes the page", async () => savePage(t, desktop, app, isolatedWindow, isolated.shell, portal, folder, "isolated", "Acceptance page 4"));
    const priv = await openPrivateByKeys(desktop, app, mainWindow, shell);
    const tab = await priv.shell.activeTabId();
    const page = t.fixtures.url.page(6, `private-${run}`);
    await priv.shell.navigate(tab, page);
    await priv.shell.waitTabUrl(tab, (u) => u === page);
    const privWindow = priv.window;
    await t.check("private window: Ctrl+P opens the print preview over it and Escape closes it", async () => printPreview(t, desktop, app, privWindow, priv.shell, "private"));
    await t.check("private window: the page menu's Save as… asks the portal where to save and writes the page", async () => savePage(t, desktop, app, privWindow, priv.shell, portal, folder, "private", "Acceptance page 6"));
    await t.stop(app);
  },
};

export default [privateLinkDesktop, windowMenuDesktop, privateDownloadsDesktop, pageCommandsDesktop];
