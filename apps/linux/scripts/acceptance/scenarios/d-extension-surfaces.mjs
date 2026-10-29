import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { clickTextIn, currentRect, desktopShot, desktopUnavailable, hasFocus, openDesktop, openSettingsWindow, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { chooseMenuItem, clickNeutral, everyWindowIsArdia, labelRect, openedWindow, pageOrigin, removeExtensionInSettings, rightClickMenu, shellLines, whiteBox } from "../lib/desktopUi.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { openPopupByShortcut, POPUP_SHORTCUT, POPUP_SIZE, popupTargets, preparePopupExtension, waitPopupGone } from "./d-extensions.mjs";
import { openPrivateByKeys } from "./d-private.mjs";
import { COMMAND_SHORTCUT, FOLLOWUP_NAME, followupOf, prepareFollowupExtension, SEARCH_KEYWORD } from "./e-extension-followups.mjs";
import { FIXTURE_NAME, listed } from "./f09-extensions.mjs";

const OPEN_LINK_IN_INCOGNITO_FROM_POPUP = 3;
const DEVTOOLS_OPEN_IN_NEW_TAB = 1;

async function windowTitled(desktop, title) {
  return until(async () => (await desktop.windows()).find((w) => w.title.includes(title)) ?? false, { timeout: 15000, label: `a window titled ${title}` });
}

async function focusShell(desktop, window, shell) {
  if ((await desktop.focused())?.id !== window.id) await desktop.raise(window);
  await waitFocused(desktop, (w) => w.id === window.id, { label: `${window.title} focused` });
  return clickNeutral(desktop, window, shell);
}

async function liveShells(app) {
  return (await app.shells()).filter((s) => s.ready).map((s) => s.windowId);
}

async function workers(app, id) {
  const out = [];
  for (const target of (await app.targets()).filter((x) => x.type === "service_worker" && x.url.startsWith(`chrome-extension://${id}/`))) {
    const session = await app.connect(target);
    out.push({ target, session, incognito: await evaluate(session, "chrome.extension.inIncognitoContext", { userGesture: false }).catch(() => null) });
  }
  return out;
}

async function loadFixture(t, desktop, { name, incognito, link }) {
  const fixture = await preparePopupExtension(join(await t.scratch(`${name}-extension`), "fixture"), { incognito, link });
  const { app, shell } = await startDesktopBrowser(t, desktop, { name, extensions: true, extraArgs: [`--load-extension=${fixture}`], session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
  const ext = await until(async () => listed(await shell.call("extensions.list", {})) ?? false, { timeout: 20000, label: "the fixture extension" });
  return { app, shell, ext, fixture };
}

async function configure(shell, id, options) {
  const reply = await shell.call("extensions.configure", { id, options });
  if (!reply.ok) throw new Error(`extensions.configure failed: ${reply.code} ${reply.message}`);
  await until(async () => { const x = (await shell.call("extensions.list", {})).value?.extensions?.find((e) => e.id === id); return x?.enabled && Object.entries(options).every(([k, v]) => x[k] === v) ? x : false; }, { timeout: 20000, label: `the extension ${JSON.stringify(options)}` });
}

async function privateWithFixture(t, desktop, { name, incognito }) {
  const state = await loadFixture(t, desktop, { name, incognito });
  await configure(state.shell, state.ext.id, { incognito: true, pinned: true });
  const mainWindow = await windowTitled(desktop, "Acceptance page 1");
  const priv = await openPrivateByKeys(desktop, state.app, mainWindow, state.shell);
  const tab = await priv.shell.activeTabId();
  const page = t.fixtures.url.page(2, nonce("private"));
  await priv.shell.navigate(tab, page);
  await priv.shell.waitTabUrl(tab, (u) => u === page);
  return { ...state, mainWindow, priv };
}

async function popupInPrivate(t, desktop, state, name) {
  await focusShell(desktop, state.priv.window, state.priv.shell);
  const popup = await openPopupByShortcut(t, desktop, state.app, state.ext.id, name);
  const owner = await state.priv.shell.eval("ardiaLinux.extensions.getState().popup");
  if (owner?.windowId !== state.priv.shell.windowId) throw new Error(`the popup belongs to ${JSON.stringify(owner)}`);
  const incognito = await evaluate(popup.session, "chrome.extension.inIncognitoContext", { userGesture: false });
  return { popup, incognito };
}

async function closePopupOutside(desktop, state, window, shell) {
  const frame = await currentRect(desktop, window);
  const origin = await pageOrigin(shell);
  await desktop.click(frame.x + origin.x + 200, frame.y + origin.y + 400);
  await waitPopupGone(state.app, state.ext.id, "the popup to close");
}

export const privateSplitDesktop = {
  id: "F02-99D",
  issue: 99,
  desktop: true,
  title: "A split-mode extension allowed in incognito shows its button in a private window, and its popup and side panel open there in the incognito context (sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Toolbar, popup and side panel in a private window", ["Allow a split-mode extension in incognito: its button shows in a private window, its popup and side panel open there."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const state = await privateWithFixture(t, desktop, { name: "private-split", incognito: "split" });
    await t.check("the pinned split-mode extension's button is in the private window's toolbar", async () => {
      const button = await labelRect(state.priv.shell, "Fixture Action");
      await desktopShot(t, desktop, "split-private-toolbar");
      return { button: { x: button.x, y: button.y } };
    }, { critical: true });
    await t.check("its action shortcut opens the popup in the private window, in the incognito context", async () => {
      const { incognito } = await popupInPrivate(t, desktop, state, "split-private-popup");
      if (incognito !== true) throw new Error(`the popup runs with inIncognitoContext ${incognito}`);
      await closePopupOutside(desktop, state, state.priv.window, state.priv.shell);
      return { incognito };
    });
    await t.check("with openPanelOnActionClick set by its incognito worker, the shortcut opens its side panel in the private window", async () => {
      const incognitoWorker = await until(async () => (await workers(state.app, state.ext.id)).find((w) => w.incognito === true) ?? false, { timeout: 15000, label: "the split extension's incognito service worker" });
      await evaluate(incognitoWorker.session, "chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => true)", { userGesture: false });
      await focusShell(desktop, state.priv.window, state.priv.shell);
      await desktop.key(POPUP_SHORTCUT);
      await state.priv.shell.waitFor(`ardiaLinux.extensions.getState().sidePanels[${js(state.priv.shell.windowId)}]?.extensionId === ${js(state.ext.id)}`, { timeout: 10000, label: "the side panel in the private window" });
      const panel = await until(async () => (await state.app.targets()).find((x) => x.url === `chrome-extension://${state.ext.id}/panel.html`) ?? false, { timeout: 10000, label: "the side panel page" });
      const incognito = await evaluate(await state.app.connect(panel), "chrome.extension.inIncognitoContext", { userGesture: false });
      await desktopShot(t, desktop, "split-private-side-panel");
      if (incognito !== true) throw new Error(`the side panel runs with inIncognitoContext ${incognito}`);
      if ((await popupTargets(state.app, state.ext.id)).length) throw new Error("the shortcut opened the popup as well");
      const regular = await state.shell.eval(`ardiaLinux.extensions.getState().sidePanels[${js(state.shell.windowId)}] ?? null`);
      if (regular) throw new Error(`the regular window got a side panel too: ${JSON.stringify(regular)}`);
      return { incognito };
    });
    await t.stop(state.app);
  },
};

export const privateSpanningDesktop = {
  id: "F02-149D",
  issue: 149,
  desktop: true,
  title: "A spanning-mode extension allowed in incognito shows its button in a private window and its popup opens there, with one background context (sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Spanning extension button and popup in a private window", ["Allow a spanning-mode extension in incognito and pin it; its button shows in a private window and its popup opens there."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const state = await privateWithFixture(t, desktop, { name: "private-spanning" });
    await t.check("the pinned spanning extension's button is in the private window's toolbar", async () => {
      const button = await labelRect(state.priv.shell, "Fixture Action");
      await desktopShot(t, desktop, "spanning-private-toolbar");
      return { button: { x: button.x, y: button.y } };
    }, { critical: true });
    await t.check("its action shortcut opens the popup in the private window, and the extension keeps a single background context", async () => {
      const { incognito } = await popupInPrivate(t, desktop, state, "spanning-private-popup");
      const list = await workers(state.app, state.ext.id);
      if (list.length !== 1 || list[0].incognito !== false) throw new Error(`background contexts ${JSON.stringify(list.map((w) => ({ url: w.target.url, incognito: w.incognito })))}`);
      await closePopupOutside(desktop, state, state.priv.window, state.priv.shell);
      return { popupIncognito: incognito, workers: list.length };
    });
    await t.stop(state.app);
  },
};

async function devtoolsLink(app, href) {
  const target = await until(async () => (await app.targets()).find((x) => x.url.startsWith("devtools://")) ?? false, { timeout: 15000, label: "the DevTools frontend" });
  const session = await app.connect(target);
  return until(async () => {
    await session.send("DOM.getDocument", { depth: -1, pierce: true });
    const { searchId, resultCount } = await session.send("DOM.performSearch", { query: href, includeUserAgentShadowDOM: true });
    if (!resultCount) return false;
    const { nodeIds } = await session.send("DOM.getSearchResults", { searchId, fromIndex: 0, toIndex: resultCount });
    for (const nodeId of nodeIds) {
      const node = await session.send("DOM.describeNode", { nodeId }).catch(() => null);
      if (node?.node?.nodeName !== "DEVTOOLS-LINK") continue;
      const { object } = await session.send("DOM.resolveNode", { nodeId });
      const { result } = await session.send("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true, functionDeclaration: "function () { const first = (n) => { const r = n.getClientRects?.(); return r && r.length ? r[0] : null; }; let r = first(this); if (!r || !r.width) { const range = document.createRange(); range.selectNodeContents(this.shadowRoot ?? this); r = range.getClientRects()[0] ?? null; } return r && r.width ? { x: r.left + Math.min(r.width / 2, 24), y: r.top + r.height / 2 } : null; }" });
      if (result?.value) return result.value;
    }
    return false;
  }, { timeout: 15000, label: `the ${href} link in DevTools' Elements tree` });
}

async function linkAtPoint(app, at) {
  const session = await app.connect((await app.targets()).find((x) => x.url.startsWith("devtools://")));
  await session.send("DOM.getDocument", { depth: -1, pierce: true });
  const hit = await session.send("DOM.getNodeForLocation", { x: Math.round(at.x), y: Math.round(at.y), includeUserAgentShadowDOM: true });
  const { object } = await session.send("DOM.resolveNode", { nodeId: hit.nodeId });
  const { result } = await session.send("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true, functionDeclaration: "function () { const path = []; for (let n = this; n; n = n.parentElement ?? n.getRootNode?.().host ?? null) { path.push(n.nodeName); if (n.nodeName === 'DEVTOOLS-LINK') return { ok: true, path: path.join(' < ') }; if (path.length > 12) break; } return { ok: false, path: path.join(' < ') }; }" });
  return result.value;
}

export const privateLinksSurfacesDesktop = {
  id: "F02-150D",
  issue: 150,
  desktop: true,
  title: "An incognito link from an extension popup's native menu, and Open in new tab from DevTools on a private tab, open in Ardia's own private windows and never in a plain Chrome window (sway)",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Open Link in Incognito Window from an extension popup", ["Right-click a link in an extension popup and choose Open Link in Incognito Window."], missing);
      t.manual("Open Link in Incognito Window from DevTools", ["From DevTools, open a link of a private tab."], missing);
      return;
    }
    const run = nonce("pv150d");
    const desktop = await openDesktop(t);
    const link = t.fixtures.url.page(7, run);
    const state = await loadFixture(t, desktop, { name: "popup-links", link });
    await configure(state.shell, state.ext.id, { pinned: true });
    const window = await windowTitled(desktop, "Acceptance page 1");
    const button = await labelRect(state.shell, "Fixture Action");
    await t.check("Open link in incognito window from the popup's native context menu opens an Ardia private window on the link", async () => {
      await focusShell(desktop, window, state.shell);
      const popup = await openPopupByShortcut(t, desktop, state.app, state.ext.id, "popup-with-link");
      const frame = await currentRect(desktop, window);
      const open = await desktop.capture();
      const box = whiteBox(open, { x: frame.x + button.right - 20, y: frame.y + button.bottom + POPUP_SIZE.height - 14 });
      if (!box) throw new Error("the popup was not found on screen");
      const r = await evaluate(popup.session, "(() => { const r = document.getElementById('link').getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }; })()", { userGesture: false });
      const known = await desktop.windows();
      const shells = await liveShells(state.app);
      await rightClickMenu(desktop, { x: box.x + r.x, y: box.y + r.y });
      await desktopShot(t, desktop, "popup-link-menu");
      await chooseMenuItem(desktop, OPEN_LINK_IN_INCOGNITO_FROM_POPUP);
      const opened = await openedWindow(desktop, state.app, known, shells, { label: "the incognito window from the popup" });
      const url = await opened.shell.waitState("const w = s.windows[windowId]; return s.tabs[w?.activeTabIds?.[w.profileId]]?.url || null;", { timeout: 15000, label: "its tab" });
      await desktopShot(t, desktop, "popup-link-opened");
      if (!opened.shell.privateWindow) throw new Error(`${opened.shell.windowId} is not private`);
      if (url !== link) throw new Error(`the private tab is on ${url}`);
      return { profile: opened.shell.profileId, ...(await everyWindowIsArdia(desktop, state.app)) };
    });
    await t.check("Open in new tab on a link in DevTools attached to a private tab opens it in an Ardia private window", async () => {
      const mainWindow = await windowTitled(desktop, "Acceptance page 1");
      const priv = await openPrivateByKeys(desktop, state.app, mainWindow, state.shell);
      const tab = await priv.shell.activeTabId();
      const hover = t.fixtures.url.page(1).replace(/\/page\/1.*$/, `/hover?run=${run}`);
      await priv.shell.navigate(tab, hover);
      await priv.shell.waitTabUrl(tab, (u) => u === hover);
      await focusShell(desktop, priv.window, priv.shell);
      await desktop.key("ctrl+shift+i");
      const href = `/page/5?hover=${run}`;
      const at = await devtoolsLink(state.app, href).catch(async (error) => {
        await desktopShot(t, desktop, "devtools-missing");
        throw error;
      });
      const frame = await currentRect(desktop, priv.window);
      const origin = await pageOrigin(priv.shell);
      const beforeTabs = await priv.shell.state("return s.windows[windowId].tabIds.length;");
      const onLink = await linkAtPoint(state.app, at);
      if (!onLink.ok) throw new Error(`the point ${JSON.stringify(at)} in DevTools is on ${onLink.path}, not the link`);
      const known = await desktop.windows();
      await rightClickMenu(desktop, { x: frame.x + origin.x + at.x, y: frame.y + origin.y + at.y });
      await desktopShot(t, desktop, "devtools-link-menu");
      await chooseMenuItem(desktop, DEVTOOLS_OPEN_IN_NEW_TAB);
      const target = new URL(href, hover).href;
      const where = await until(async () => {
        for (const id of await liveShells(state.app)) {
          const shell = await state.app.shell(id).catch(() => null);
          if (!shell) continue;
          const urls = await shell.state("return (s.windows[windowId]?.tabIds ?? []).map((id) => s.tabs[id]?.url);").catch(() => []);
          if (urls.includes(target)) return { windowId: id, privateWindow: shell.privateWindow };
        }
        return false;
      }, { timeout: 15000, label: `a tab on ${target} in an Ardia window` }).catch(async (error) => {
        await desktopShot(t, desktop, "devtools-link-missing");
        const hidden = (await state.app.targets()).filter((x) => x.type === "page" && x.url === target);
        throw new Error(`${error.message}; ${hidden.length} page target(s) on it exist outside every Ardia window's tabs (#275); windows ${JSON.stringify((await desktop.windows()).map((w) => w.title))}`);
      });
      await desktopShot(t, desktop, "devtools-link-opened");
      if (!where.privateWindow) throw new Error(`the link opened in the regular window ${where.windowId}`);
      return { ...where, tabsBefore: beforeTabs, newWindows: (await desktop.windows()).length - known.length, ...(await everyWindowIsArdia(desktop, state.app)) };
    });
    await t.stop(state.app);
  },
};

async function loadFollowups(t, desktop, name, { sidePanel = false } = {}) {
  const fixture = await prepareFollowupExtension(join(await t.scratch(`${name}-extension`), "fixture"));
  if (sidePanel) {
    const manifest = JSON.parse(await readFile(join(fixture, "manifest.json"), "utf8"));
    manifest.side_panel = { default_path: "panel.html" };
    manifest.permissions = [...new Set([...(manifest.permissions ?? []), "sidePanel"])];
    await writeFile(join(fixture, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(join(fixture, "panel.html"), "<!doctype html><html><body><p>Follow-up panel</p></body></html>\n");
  }
  const { app, shell } = await startDesktopBrowser(t, desktop, { name, extensions: true, extraArgs: [`--load-extension=${fixture}`], session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
  const ext = await until(async () => followupOf(await shell.call("extensions.list", {})) ?? false, { timeout: 20000, label: "the follow-up fixture" });
  const worker = await until(async () => (await workers(app, ext.id))[0] ?? false, { timeout: 20000, label: "the follow-up fixture's worker" });
  return { app, shell, ext, worker: worker.session };
}

const followupPopup = (app, id) => until(async () => (await app.targets()).find((x) => x.url === `chrome-extension://${id}/popup.html`) ?? false, { timeout: 8000, label: "the follow-up popup" });

export const searchProviderDesktop = {
  id: "E97D",
  issue: 97,
  desktop: true,
  title: "An extension's search provider is listed in Settings › Search Engine and disappears when the extension is removed from Settings › Extensions (sway)",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("The provider appears in Settings › Search", ["Settings › Search lists the fixture's engine; removing the extension removes it."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const { app, shell, ext } = await loadFollowups(t, desktop, "search-provider");
    const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Search Engine" });
    let anchor;
    await t.check("Settings › Search Engine lists Ardia Fixture Search", async () => {
      await settings.waitFor("document.body.innerText.includes('Ardia Fixture Search')", { timeout: 15000, label: "the provider in Settings › Search Engine" });
      await desktopShot(t, desktop, "search-engine-pane");
      const lines = await shellLines(settings);
      const pane = lines.slice(lines.lastIndexOf("Search Engine") + 1);
      anchor = pane.find((l) => l.length > 3 && !/Fixture|ardiasearch|^[×−+]$/.test(l));
      if (!anchor) throw new Error(`no other row in the pane to recognise it by: ${JSON.stringify(pane.slice(0, 20))}`);
      return { rows: lines.filter((l) => /Ardia Fixture Search|ardiasearch/.test(l)), anchor };
    }, { critical: true });
    await t.check("removing the extension in Settings › Extensions takes the provider out of Settings › Search Engine", async () => {
      await clickTextIn(desktop, window, settings, "Extensions");
      await settings.waitFor(`document.body.innerText.includes(${js(FOLLOWUP_NAME)})`, { timeout: 10000, label: "the fixture in Settings › Extensions" });
      await removeExtensionInSettings(desktop, window, settings, FOLLOWUP_NAME, async () => !(await shell.call("extensions.list", {})).value.extensions.some((x) => x.id === ext.id));
      await desktopShot(t, desktop, "extension-removed");
      await clickTextIn(desktop, window, settings, "Search Engine");
      await settings.waitFor(`document.body.innerText.includes(${js(anchor)})`, { timeout: 10000, label: `the Search Engine pane (its ${anchor} row)` });
      await delay(1000);
      if ((await settings.text()).includes("Ardia Fixture Search")) throw new Error("the provider is still listed");
      await desktopShot(t, desktop, "search-engine-after-remove");
      return true;
    });
    await t.stop(app);
  },
};

async function commandReports(worker) {
  return evaluate(worker, "globalThis.commandReports ?? []", { userGesture: false });
}

async function popupReports(worker) {
  return evaluate(worker, "globalThis.popupReports ?? []", { userGesture: false });
}

async function activeChromeTab(worker) {
  return evaluate(worker, "chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.id ?? null)", { userGesture: false });
}

const windowShortcuts = (shell) => shell.state("return JSON.stringify(s.settings.shortcuts ?? {});");

async function shortcutField(settings, label) {
  return until(() => settings.eval(`(() => {
    const labels = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === ${js(label)} && n.children.length === 0 && n.getBoundingClientRect().width > 0);
    const label = labels[0];
    if (!label) return null;
    const box = label.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const field = [...document.querySelectorAll('*')].filter((n) => { const r = n.getBoundingClientRect(); return r.left >= box.right && r.width > 60 && r.width < 220 && r.height > 14 && r.height < 40 && Math.abs(r.top + r.height / 2 - middle) < 12; }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!field) return null;
    const r = field.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: field.innerText.trim() };
  })()`), { timeout: 10000, label: `the ${label} shortcut field` });
}

export const shortcutsDesktop = {
  id: "E98D",
  issue: 98,
  desktop: true,
  title: "Extension shortcuts typed through the native window: _execute_action opens the popup under the button once per press, named commands fire, Ardia's own assignment wins, and the action shortcut toggles a side panel (sway)",
  deadline: 420000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      for (const name of ["_execute_action opens the popup under Ardia's toolbar button", "Named commands fire chrome.commands.onCommand", "Extension shortcuts never shadow Ardia's", "Side panel through the action shortcut"]) t.manual(name, ["See E98's manual steps."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const state = await loadFollowups(t, desktop, "extension-shortcuts");
    const { app, shell, ext, worker } = state;
    await configure(shell, ext.id, { pinned: true });
    const window = await windowTitled(desktop, "Acceptance page 1");
    await t.check("Alt+Shift+Y opens the popup anchored to the extension's toolbar button for this window; holding it opens it once; pressing again after it closes reopens it", async () => {
      await focusShell(desktop, window, shell);
      const button = await labelRect(shell, "Follow-up Action");
      await desktop.keyDown("alt");
      await desktop.keyDown("shift");
      await desktop.keyDown("y");
      await delay(1500);
      await desktop.keyUp("y");
      await desktop.keyUp("shift");
      await desktop.keyUp("alt");
      await followupPopup(app, ext.id);
      await desktopShot(t, desktop, "followup-popup");
      const frameNow = await currentRect(desktop, window);
      const popup = await until(async () => { const p = await shell.eval("ardiaLinux.extensions.getState().popup"); return p?.anchor && p.anchor.x < frameNow.width ? p : false; }, { timeout: 8000, label: "the popup's anchor on screen" }).catch(async (error) => { throw new Error(`${error.message}; the shell's popup is ${JSON.stringify(await shell.eval("ardiaLinux.extensions.getState().popup"))}`); });
      if (popup?.extensionId !== ext.id || popup.windowId !== shell.windowId) throw new Error(`the shell's popup is ${JSON.stringify(popup)}`);
      if (Math.abs(popup.anchor.x + popup.anchor.width / 2 - button.x) > 4 || Math.abs(popup.anchor.y + popup.anchor.height / 2 - button.y) > 4) throw new Error(`anchored at ${JSON.stringify(popup.anchor)}, the button is at ${JSON.stringify(button)}`);
      await delay(800);
      const held = (await popupReports(worker)).length;
      if (held !== 1) throw new Error(`holding the shortcut opened the popup ${held} times`);
      const frame = await currentRect(desktop, window);
      const origin = await pageOrigin(shell);
      await desktop.click(frame.x + origin.x + 200, frame.y + origin.y + 400);
      await until(async () => !(await app.targets()).some((x) => x.url === `chrome-extension://${ext.id}/popup.html`), { timeout: 8000, label: "the popup to close" });
      await focusShell(desktop, window, shell);
      await desktop.key(POPUP_SHORTCUT);
      await followupPopup(app, ext.id);
      await until(async () => (await popupReports(worker)).length === 2, { timeout: 5000, label: "a second popup report" });
      await desktop.click(frame.x + origin.x + 200, frame.y + origin.y + 400);
      return { anchor: popup.anchor, opens: 2 };
    });
    await t.check("Alt+Shift+U fires the named command with the active tab, from page focus and from sidebar focus", async () => {
      const before = (await commandReports(worker)).length;
      const frame = await currentRect(desktop, window);
      const origin = await pageOrigin(shell);
      await desktop.click(frame.x + origin.x + 300, frame.y + origin.y + 300);
      await delay(300);
      await desktop.key(COMMAND_SHORTCUT.toLowerCase());
      await until(async () => (await commandReports(worker)).length === before + 1, { timeout: 5000, label: "the command from page focus" });
      await focusShell(desktop, window, shell);
      await desktop.key(COMMAND_SHORTCUT.toLowerCase());
      const reports = await until(async () => { const r = await commandReports(worker); return r.length === before + 2 ? r : false; }, { timeout: 5000, label: "the command from sidebar focus" });
      const active = await activeChromeTab(worker);
      const fresh = reports.slice(before);
      if (fresh.some((r) => r.command !== "fixture-command" || r.tabId !== active)) throw new Error(`reports ${JSON.stringify(fresh)}, active tab ${active}`);
      return { reports: fresh };
    });
    await t.check("assigning Alt+Shift+U to Duplicate in Settings › Keyboard Shortcuts makes Ardia's command run instead; Reset All Shortcuts gives it back to the extension", async () => {
      const { settings, window: settingsWindow } = await openSettingsWindow(desktop, app, shell, { pane: "Keyboard Shortcuts" });
      await settings.waitFor("document.body.innerText.includes('Duplicate')", { timeout: 10000, label: "the Keyboard Shortcuts pane" });
      const frame = await currentRect(desktop, settingsWindow);
      const search = await until(() => settings.rect('input[placeholder="Search actions"]'), { timeout: 8000, label: "the Search actions field" });
      await desktop.click(frame.x + search.x, frame.y + search.y);
      await desktop.type("Duplicate");
      await delay(800);
      const field = await shortcutField(settings, "Duplicate");
      await desktop.click(frame.x + field.x, frame.y + field.y);
      await delay(500);
      const firedBefore = (await commandReports(worker)).length;
      const bindingsBefore = await windowShortcuts(shell);
      await desktop.key(COMMAND_SHORTCUT.toLowerCase());
      const assigned = await until(async () => { const f = await shortcutField(settings, "Duplicate"); return /Alt\+Shift\+U/i.test(f.text) ? f.text : false; }, { timeout: 6000, label: "Duplicate to show Alt+Shift+U" }).catch(async (error) => {
        await desktopShot(t, desktop, "shortcut-assign");
        const fired = (await commandReports(worker)).length - firedBefore;
        await desktop.key("alt+shift+k");
        await delay(1000);
        const other = (await shortcutField(settings, "Duplicate").catch(() => ({ text: "?" }))).text;
        await desktopShot(t, desktop, "shortcut-assign-other");
        const searchValue = await settings.eval(`document.querySelector('input[placeholder="Search actions"]')?.value ?? null`).catch(() => null);
        throw new Error(`${error.message}; the Search actions field holds ${JSON.stringify(searchValue)}; while recording, the extension's command fired ${fired} time(s); the field shows ${JSON.stringify(other)} after an unused Alt+Shift+K`);
      });
      await desktopShot(t, desktop, "shortcut-assigned");
      const binding = await until(async () => { const now = await windowShortcuts(shell); return now !== bindingsBefore ? now : false; }, { timeout: 8000, label: "the new binding in the browser window's settings" });
      const before = (await commandReports(worker)).length;
      const tabs = await shell.state("return s.windows[windowId].tabIds.length;");
      await focusShell(desktop, window, shell);
      await desktop.key(COMMAND_SHORTCUT.toLowerCase());
      await shell.waitState(`return s.windows[windowId].tabIds.length === ${tabs + 1} || null;`, { timeout: 8000, label: "Duplicate to add a tab" });
      await delay(1000);
      if ((await commandReports(worker)).length !== before) throw new Error("the extension's command fired too");
      if ((await desktop.focused())?.id !== settingsWindow.id) await desktop.raise(settingsWindow);
      await clickTextIn(desktop, settingsWindow, settings, "Reset All Shortcuts");
      await delay(800);
      for (const host of [settings, shell]) {
        if (await host.rectByText("Reset")) {
          const hostWindow = host === settings ? settingsWindow : window;
          await clickTextIn(desktop, hostWindow, host, "Reset").catch(() => {});
        }
      }
      await until(async () => !/Alt\+Shift\+U/i.test((await shortcutField(settings, "Duplicate")).text), { timeout: 8000, label: "Duplicate's shortcut to reset" });
      await until(async () => (await windowShortcuts(shell)) === bindingsBefore, { timeout: 8000, label: "the reset to reach the browser window's settings" });
      await focusShell(desktop, window, shell);
      await desktop.key(COMMAND_SHORTCUT.toLowerCase());
      await until(async () => (await commandReports(worker)).length === before + 1, { timeout: 5000, label: "the extension's command after the reset" });
      return { assigned, binding };
    });
    await t.stop(app);
    await t.check("with openPanelOnActionClick, Alt+Shift+Y opens the extension's side panel instead of its popup, and pressing it again closes the panel", async () => {
      const panelState = await loadFollowups(t, desktop, "extension-side-panel", { sidePanel: true });
      await configure(panelState.shell, panelState.ext.id, { pinned: true });
      await evaluate(panelState.worker, "chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => true)", { userGesture: false });
      const panelWindow = await windowTitled(desktop, "Acceptance page 1");
      await focusShell(desktop, panelWindow, panelState.shell);
      const opened = `ardiaLinux.extensions.getState().sidePanels[${js(panelState.shell.windowId)}]?.extensionId === ${js(panelState.ext.id)}`;
      await desktop.key(POPUP_SHORTCUT);
      await panelState.shell.waitFor(opened, { timeout: 10000, label: "the side panel" });
      await desktopShot(t, desktop, "side-panel-shortcut");
      await delay(800);
      if ((await panelState.app.targets()).some((x) => x.url === `chrome-extension://${panelState.ext.id}/popup.html`)) throw new Error("the popup opened as well");
      await focusShell(desktop, panelWindow, panelState.shell);
      await desktop.key(POPUP_SHORTCUT);
      await panelState.shell.waitFor(`!(${opened})`, { timeout: 8000, label: "the side panel to close on the second press" });
      await t.stop(panelState.app);
      return true;
    });
  },
};

export default [privateSplitDesktop, privateSpanningDesktop, privateLinksSurfacesDesktop, searchProviderDesktop, shortcutsDesktop];
