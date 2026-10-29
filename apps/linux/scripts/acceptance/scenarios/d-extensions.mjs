import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { crxKey, writeCrx } from "../lib/crx.mjs";
import { clickTextIn, currentRect, desktopShot, desktopUnavailable, hasFocus, openDesktop, openSettingsWindow, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { clickDialogButton, clickNeutral, labelRect, networkReachable, whiteBox, pageOrigin, rowToggle, saveCapture, shellLines, surfaceAfter } from "../lib/desktopUi.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { FIXTURE_NAME, listed, prepareExtension } from "./f09-extensions.mjs";

export const POPUP_SHORTCUT = "alt+shift+y";
export const POPUP_SIZE = { width: 240, height: 120 };

export async function preparePopupExtension(dir, { incognito, link } = {}) {
  await prepareExtension(dir);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  manifest.commands = { _execute_action: { suggested_key: { default: "Alt+Shift+Y" } } };
  if (incognito) manifest.incognito = incognito;
  else delete manifest.incognito;
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, "popup.html"), `<!doctype html>
<html>
  <body style="margin: 0; padding: 12px; box-sizing: border-box; width: ${POPUP_SIZE.width}px; height: ${POPUP_SIZE.height}px; font: 13px sans-serif; background: #fff">
    <p id="label" style="margin: 0 0 6px">Fixture popup</p>
    <input id="field" autofocus>
    <button id="close">Close</button>
    ${link ? `<a id="link" href="${link}" style="display:block;font-size:20px">Fixture link</a>` : ""}
    <script src="popup.js"></script>
  </body>
</html>
`);
  await writeFile(join(dir, "popup.js"), `document.getElementById("close").addEventListener("click", () => window.close());
document.getElementById("field").addEventListener("input", (event) => chrome.runtime.sendMessage({ kind: "typed", value: event.target.value }));
chrome.runtime.sendMessage({ kind: "popup", href: location.href, incognito: chrome.extension.inIncognitoContext, popupViews: chrome.extension.getViews({ type: "popup" }).length });
`);
  return dir;
}

export async function popupTargets(app, id) {
  return (await app.targets()).filter((x) => x.url === `chrome-extension://${id}/popup.html`);
}

export async function waitPopup(app, id, { timeout = 10000 } = {}) {
  const target = await until(async () => (await popupTargets(app, id))[0] ?? false, { timeout, label: "the extension popup page" });
  const session = await app.connect(target);
  await until(() => evaluate(session, "document.readyState === 'complete'", { userGesture: false }).catch(() => false), { timeout, label: "the popup page to load" });
  return { target, session };
}

export async function waitPopupGone(app, id, label) {
  await until(async () => !(await popupTargets(app, id)).length, { timeout: 8000, label });
}

export async function openPopupByShortcut(t, desktop, app, id, name) {
  const found = await surfaceAfter(desktop, () => desktop.key(POPUP_SHORTCUT), { settle: 2000 });
  const popup = await waitPopup(app, id);
  if (found.after) await saveCapture(t, name, found.after).catch(() => null);
  await desktopShot(t, desktop, name);
  return { ...popup, region: found.region, box: found.box };
}

export function popupPlacement(box, button, frame) {
  const problems = [];
  if (!box) return ["no popup surface was found on screen"];
  const anchor = { left: frame.x + button.left, right: frame.x + button.right, bottom: frame.y + button.bottom };
  if (box.y < anchor.bottom - 4 || box.y > anchor.bottom + 24) problems.push(`its top ${box.y} is not just under the button's bottom ${anchor.bottom}`);
  if (box.x > anchor.right || box.x + box.width < anchor.left) problems.push(`it doesn't overlap the button horizontally (${box.x}..${box.x + box.width} vs ${anchor.left}..${anchor.right})`);
  if (box.x < frame.x - 2 || box.x + box.width > frame.x + frame.width + 2) problems.push(`it leaves the window (${box.x}..${box.x + box.width} vs ${frame.x}..${frame.x + frame.width})`);
  if (box.width < POPUP_SIZE.width - 2 || box.width > POPUP_SIZE.width + 40 || box.height < POPUP_SIZE.height - 2 || box.height > POPUP_SIZE.height + 40) problems.push(`its size ${box.width}×${box.height} is not the popup's ${POPUP_SIZE.width}×${POPUP_SIZE.height}`);
  return problems;
}

async function reports(app, id) {
  const target = (await app.targets()).find((x) => x.type === "service_worker" && x.url.startsWith(`chrome-extension://${id}/`));
  if (!target) return [];
  return evaluate(await app.connect(target), "globalThis.fixtureReports ?? []", { userGesture: false }).catch(() => []);
}

async function windowTitled(desktop, title) {
  return until(async () => (await desktop.windows()).find((w) => w.title.includes(title)) ?? false, { timeout: 15000, label: `a window titled ${title}` });
}

async function focusShell(desktop, window, shell) {
  if ((await desktop.focused())?.id !== window.id) await desktop.raise(window);
  await waitFocused(desktop, (w) => w.id === window.id, { label: `${window.title} focused` });
  return clickNeutral(desktop, window, shell);
}

export const popupDesktop = {
  id: "F09P",
  issue: 19,
  desktop: true,
  title: "A pinned extension's popup opens under its toolbar button at its own size, takes typing, and closes on Escape, an outside click and its own Close; the toolbar button itself is clicked last (sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Popup placement, focus and keyboard", ["Pin the fixture and open its popup: it opens under the button at its own size, takes typing, and closes on Escape, an outside click and its Close."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const fixture = await preparePopupExtension(join(await t.scratch("popup-extension"), "fixture"));
    const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "spare", urls: [t.fixtures.url.page(2)] }], focused: "main" });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "popup", extensions: true, extraArgs: [`--load-extension=${fixture}`], session });
    const ext = await until(async () => listed(await shell.call("extensions.list", {})) ?? false, { timeout: 20000, label: "the fixture extension" });
    const pinned = await shell.call("extensions.configure", { id: ext.id, options: { pinned: true } });
    if (!pinned.ok) throw new Error(`pinning failed: ${pinned.code} ${pinned.message}`);
    const window = await windowTitled(desktop, "Acceptance page 1");
    const button = await labelRect(shell, "Fixture Action");
    let popup;
    await t.check("the action shortcut opens the extension popup in this window", async () => {
      await focusShell(desktop, window, shell);
      popup = await openPopupByShortcut(t, desktop, app, ext.id, "popup-open");
      const store = await shell.eval("ardiaLinux.extensions.getState().popup");
      if (store?.extensionId !== ext.id || store.windowId !== shell.windowId) throw new Error(`the shell's popup is ${JSON.stringify(store)}`);
      return { url: popup.target.url };
    }, { critical: true });
    let open;
    await t.check("the popup takes keyboard focus when it opens, so typing goes to its field", async () => {
      open = await desktop.capture();
      await saveCapture(t, "popup-open-capture", open).catch(() => null);
      await desktop.type("hello");
      const state = await evaluate(popup.session, "({ focus: document.hasFocus(), active: document.activeElement?.id ?? null, value: document.getElementById('field').value })", { userGesture: false });
      const page = (await shell.eval("document.activeElement?.value ?? ''")) ?? "";
      if (state.value !== "hello") throw new Error(`the popup's field holds ${JSON.stringify(state.value)} (focus ${state.focus}, active ${state.active}); the window's focused field holds ${JSON.stringify(page)}`);
      return state;
    });
    let box;
    await t.check("clicking outside the popup closes it", async () => {
      const frame = await currentRect(desktop, window);
      const origin = await pageOrigin(shell);
      await desktop.click(frame.x + origin.x + 200, frame.y + origin.y + 400);
      await waitPopupGone(app, ext.id, "the popup to close on an outside click");
      return true;
    });
    await t.check("the popup sat just under the toolbar button, inside the window, at its own size", async () => {
      const frame = await currentRect(desktop, window);
      box = whiteBox(open, { x: frame.x + button.right - 20, y: frame.y + button.bottom + POPUP_SIZE.height - 14 });
      const problems = popupPlacement(box, button, frame);
      if (problems.length) throw new Error(`${problems.join("; ")}; popup ${JSON.stringify(box)}, button ${JSON.stringify(button)}, window ${JSON.stringify(frame)}`);
      return { popup: box, button: { left: frame.x + button.left, right: frame.x + button.right, bottom: frame.y + button.bottom } };
    });
    const clickIn = async (session, selector) => {
      if (!box) throw new Error("the popup's position on screen is unknown");
      const r = await evaluate(session, `(() => { const r = document.querySelector(${js(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, { userGesture: false });
      await desktop.click(box.x + r.x, box.y + r.y);
    };
    await t.check("after clicking into the popup's field, typing goes there and Escape closes the popup", async () => {
      await focusShell(desktop, window, shell);
      const again = await openPopupByShortcut(t, desktop, app, ext.id, "popup-reopened");
      await clickIn(again.session, "#field");
      await until(() => evaluate(again.session, "document.hasFocus()", { userGesture: false }), { timeout: 5000, label: "keyboard focus in the popup after clicking its field" });
      await desktop.type("typed");
      await until(() => evaluate(again.session, "document.getElementById('field').value", { userGesture: false }).then((v) => v === "typed" && v), { timeout: 5000, label: "typed in the popup's field" });
      await desktop.key("escape");
      await waitPopupGone(app, ext.id, "the popup to close on Escape");
      if (await shell.eval("ardiaLinux.extensions.getState().popup !== null")) throw new Error("the shell still holds the popup");
      return true;
    });
    await t.check("the popup's own Close button closes it", async () => {
      await focusShell(desktop, window, shell);
      const again = await openPopupByShortcut(t, desktop, app, ext.id, "popup-close-button");
      await clickIn(again.session, "#close");
      await waitPopupGone(app, ext.id, "the popup to close from its Close button");
      return true;
    });
    await t.check("clicking the pinned toolbar button opens the popup", async () => {
      await focusShell(desktop, window, shell);
      const frame = await currentRect(desktop, window);
      const before = (await desktop.windows()).length;
      await desktop.click(frame.x + button.x, frame.y + button.y);
      const opened = await until(async () => (await popupTargets(app, ext.id)).length > 0, { timeout: 6000, label: "the popup after clicking the button" }).catch(() => false);
      await desktopShot(t, desktop, "popup-button-click");
      const after = await desktop.windows();
      if (!after.some((w) => w.id === window.id)) throw new Error(`clicking the button closed the window instead (#253); ${before} windows before, ${after.length} after`);
      if (!opened) throw new Error("no popup opened");
      return true;
    });
    await t.stop(app);
  },
};

async function installCrxByBridge(shell, file) {
  await shell.eval(`(globalThis.__acCrx = __ardiaHost.call("extensions.installCrx", "", ${js(JSON.stringify({ path: file }))}).then((value) => ({ ok: true, value: JSON.parse(value) }), (error) => ({ ok: false, message: String(error?.message ?? error) })), true)`);
}

const crxAnswer = (shell) => shell.eval("Promise.race([globalThis.__acCrx, new Promise((resolve) => setTimeout(() => resolve(null), 300))])");
const fixtureState = async (shell, id) => (await shell.call("extensions.list", {})).value?.extensions?.find((x) => x.id === id) ?? null;
const shows = async (shell, text) => (await shell.text()).includes(text);

export async function writeCrxPair(dir, name) {
  const key = crxKey();
  const out = {};
  for (const [label, version, permissions] of [["v1", "1.0", ["storage"]], ["v2", "2.0", ["storage", "history"]]]) {
    const folder = join(dir, label);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ manifest_version: 3, name, version, description: "Ardia acceptance CRX fixture", permissions, action: { default_title: name } }, null, 2));
    out[label] = await writeCrx(folder, join(dir, `${label}.crx`), key);
  }
  return out;
}

export const crxDesktop = {
  id: "F09C",
  issue: 19,
  desktop: true,
  title: "A locally signed CRX's install prompt (no store tab) stays through tab closes until answered, and a permission-increasing update asks before turning back on, from the prompt and from Settings (sway)",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("A permission-increasing update asks before re-enabling", ["Install a CRX, then a newer one of the same key that adds a permission; turning it on asks first."], missing);
      t.manual("A prompt with no tab stays until answered", ["Install a packed CRX: the dialog stays open until Add or Cancel, whatever tabs close meanwhile."], missing);
      return;
    }
    const name = "Ardia CRX Fixture";
    const pair = await writeCrxPair(await t.scratch("crx"), name);
    const desktop = await openDesktop(t);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "crx", extensions: true, session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1), t.fixtures.url.page(2)] }] }) });
    const window = await windowTitled(desktop, "Acceptance page 2");
    const title = `Add “${name}”?`;
    await t.check("the install prompt for a CRX with no store tab stays while a tab closes, and Cancel installs nothing", async () => {
      await installCrxByBridge(shell, pair.v1.file);
      await shell.waitFor(`document.body.innerText.includes(${js(title)})`, { timeout: 15000, label: "Ardia's install prompt" });
      await desktopShot(t, desktop, "crx-prompt");
      const heading = await shell.rectByText(title);
      const frame = await currentRect(desktop, window);
      await desktop.click(frame.x + heading.x, frame.y + heading.y);
      await until(() => hasFocus(shell), { timeout: 5000, label: "keyboard focus in the window with the prompt" });
      const tabs = await shell.state("return s.windows[windowId].tabIds.length;");
      await desktop.key("ctrl+w");
      await shell.waitState(`return s.windows[windowId].tabIds.length === ${tabs - 1} || null;`, { timeout: 8000, label: "Ctrl+W to close the active tab" });
      await delay(1500);
      if (!(await shows(shell, title))) throw new Error("the prompt closed with the tab");
      await clickTextIn(desktop, window, shell, "Cancel");
      const answer = await until(() => crxAnswer(shell), { timeout: 10000, label: "the install to finish after Cancel" });
      if (answer.ok) throw new Error(`Cancel installed it: ${JSON.stringify(answer)}`);
      if (await fixtureState(shell, pair.v1.id)) throw new Error("the extension is listed after Cancel");
      return { tabsBefore: tabs, answer: answer.message || "(cancelled)" };
    }, { critical: true });
    await t.check("Add Extension in the prompt installs the CRX turned on", async () => {
      await installCrxByBridge(shell, pair.v1.file);
      await shell.waitFor(`document.body.innerText.includes(${js(title)})`, { timeout: 15000, label: "Ardia's install prompt again" });
      await clickTextIn(desktop, window, shell, "Add Extension");
      const answer = await until(() => crxAnswer(shell), { timeout: 15000, label: "the install to finish" });
      if (!answer.ok || answer.value.id !== pair.v1.id) throw new Error(JSON.stringify(answer));
      const state = await until(async () => { const x = await fixtureState(shell, pair.v1.id); return x?.enabled ? x : false; }, { timeout: 10000, label: "the CRX enabled" });
      return { id: state.id, version: state.version };
    }, { critical: true });
    const reEnable = `Turn “${name}” back on?`;
    await t.check("an update that adds a permission turns the extension off and asks, naming the new permission; Cancel keeps it off", async () => {
      await installCrxByBridge(shell, pair.v2.file);
      await shell.waitFor(`document.body.innerText.includes(${js(reEnable)})`, { timeout: 20000, label: "the re-enable prompt" });
      await desktopShot(t, desktop, "crx-reenable-prompt");
      const lines = await shellLines(shell);
      const permission = lines.slice(lines.indexOf(reEnable) + 1).find((l) => /history/i.test(l));
      if (!permission) throw new Error(`the prompt names no new permission: ${JSON.stringify(lines.slice(lines.indexOf(reEnable), lines.indexOf(reEnable) + 6))}`);
      const off = await fixtureState(shell, pair.v1.id);
      if (off.enabled || off.version !== "2.0") throw new Error(`after the update: ${JSON.stringify({ enabled: off.enabled, version: off.version })}`);
      await clickTextIn(desktop, window, shell, "Cancel");
      await delay(1500);
      if ((await fixtureState(shell, pair.v1.id)).enabled) throw new Error("Cancel turned it on");
      return { permission, version: off.version };
    });
    await t.check("turning it on in Settings › Extensions asks again; Cancel keeps it off and Turn On turns it on", async () => {
      const { settings, window: settingsWindow } = await openSettingsWindow(desktop, app, shell, { pane: "Extensions" });
      await settings.waitFor(`document.body.innerText.includes(${js(name)})`, { timeout: 10000, label: "the CRX in Settings › Extensions" });
      const toggle = async () => {
        const control = await until(() => rowToggle(settings, name), { timeout: 8000, label: "the extension's toggle" });
        const frame = await currentRect(desktop, settingsWindow);
        await desktop.click(frame.x + control.x, frame.y + control.y);
      };
      const promptHost = async () => {
        for (const candidate of [settings, shell]) if (await shows(candidate, reEnable)) return candidate;
        return null;
      };
      await toggle();
      const host = await until(promptHost, { timeout: 10000, label: "the re-enable prompt after the Settings toggle" });
      await desktopShot(t, desktop, "crx-reenable-from-settings");
      const hostWindow = host === settings ? settingsWindow : window;
      await clickTextIn(desktop, hostWindow, host, "Cancel");
      await delay(1500);
      if ((await fixtureState(shell, pair.v1.id)).enabled) throw new Error("Cancel turned it on");
      await toggle();
      await until(promptHost, { timeout: 10000, label: "the re-enable prompt a second time" });
      await clickTextIn(desktop, hostWindow, host, "Turn On");
      const on = await until(async () => { const x = await fixtureState(shell, pair.v1.id); return x?.enabled ? x : false; }, { timeout: 10000, label: "the extension turned on" });
      return { promptIn: host === settings ? "Settings" : "the browser window", version: on.version };
    });
    await t.stop(app);
  },
};

export const STORE_HOSTS = ["chromewebstore.google.com", "clients2.google.com", "clients2.googleusercontent.com", "*.gstatic.com", "lh3.googleusercontent.com", "*.gvt1.com"];

export function storeResolverRules() {
  return `--host-resolver-rules=MAP *.ardia.test 127.0.0.1, MAP * ~NOTFOUND, ${[...STORE_HOSTS, "localhost", "127.0.0.1"].map((host) => `EXCLUDE ${host}`).join(", ")}`;
}

export const STORE_LISTING = "https://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh";
export const STORE_NAME = "uBlock Origin Lite";
const STORE_ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";
const onListing = (url) => url.startsWith("https://chromewebstore.google.com/") && url.includes(STORE_ID);

async function storeButton(app, shell, desktop, window) {
  const page = await until(async () => (await app.targets()).find((x) => x.type === "page" && onListing(x.url)) ?? false, { timeout: 30000, label: "the store listing" });
  const session = await app.connect(page);
  await until(() => evaluate(session, "document.readyState === 'complete'", { timeout: 3000, userGesture: false }), { timeout: 30000, label: "the listing to load" });
  const area = await pageOrigin(shell);
  await until(async () => Math.abs((await evaluate(session, "innerWidth", { timeout: 3000, userGesture: false })) - area.width) < 3, { timeout: 15000, label: "the listing to lay out at the page area's width" });
  await delay(1500);
  const inPage = await until(() => evaluate(session, `(() => { const n = [...document.querySelectorAll('button, [role=button], a')].find((b) => /^(Add to|Remove from) /.test((b.innerText ?? '').trim()) && b.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: n.innerText.trim() }; })()`, { timeout: 3000, userGesture: false }), { timeout: 30000, label: "the listing's Add button" });
  const frame = await currentRect(desktop, window);
  const origin = await pageOrigin(shell);
  return { x: frame.x + origin.x + inPage.x, y: frame.y + origin.y + inPage.y, text: inPage.text, session };
}

export const storeDesktop = {
  id: "F09S",
  issue: 19,
  desktop: true,
  title: "The Chrome Web Store's Add to Ardia shows Ardia's consent dialog: Cancel installs nothing, closing the store tab dismisses it, Add installs (needs network, sway)",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    const offline = missing ? null : await networkReachable("https://chromewebstore.google.com/");
    if (missing || offline) {
      t.manual("Web Store install shows Ardia's consent dialog and Cancel installs nothing", ["Add to Ardia on a store listing shows Ardia's dialog; Cancel installs nothing."], missing ?? `needs network access to the Chrome Web Store: ${offline}`);
      t.manual("Closing the Web Store tab dismisses its prompt", ["With Ardia's dialog open, close the store tab: the dialog disappears and nothing is installed."], missing ?? `needs network access to the Chrome Web Store: ${offline}`);
      return;
    }
    const desktop = await openDesktop(t);
    const network = [storeResolverRules()];
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "store", extensions: true, extraArgs: network, session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1), STORE_LISTING] }] }) });
    const window = await windowTitled(desktop, "Chrome Web Store");
    const title = `Add “${STORE_NAME}”?`;
    const installed = async () => (await shell.call("extensions.list", {})).value?.extensions?.find((x) => x.name === STORE_NAME) ?? null;
    const add = async (name) => {
      const button = await storeButton(app, shell, desktop, window);
      if (!button.text.startsWith("Add to")) throw new Error(`the listing offers ${button.text}`);
      await desktop.pointerMove(button.x, button.y);
      await delay(400);
      await desktop.click(button.x, button.y);
      await shell.waitFor(`document.body.innerText.includes(${js(title)})`, { timeout: 30000, label: "Ardia's consent dialog" }).catch(async (error) => {
        await desktopShot(t, desktop, `${name}-missing`);
        throw new Error(`${error.message}; clicked ${button.text} at ${button.x},${button.y}`);
      });
      await desktopShot(t, desktop, name);
      return button;
    };
    await t.check("Add to Ardia shows Ardia's dialog with the extension's permissions; Cancel installs nothing and the listing offers Add again", async () => {
      const button = await add("store-dialog");
      const lines = await shellLines(shell);
      const at = lines.indexOf(title);
      const details = lines.slice(at + 1, at + 4);
      if (!details.some((l) => /Read|change|data|websites/i.test(l))) throw new Error(`the dialog lists no permission: ${JSON.stringify(details)}`);
      await clickDialogButton(desktop, window, shell, title, "Cancel");
      await until(async () => !(await shows(shell, title)), { timeout: 8000, label: "the dialog to close on Cancel" }).catch(async (error) => {
        await desktopShot(t, desktop, "store-cancel-ignored");
        const focus = await hasFocus(shell);
        await desktop.key("escape");
        const escaped = await until(async () => !(await shows(shell, title)), { timeout: 5000, label: "Escape" }).then(() => true, () => false);
        throw new Error(`${error.message}; the window ${focus ? "has" : "lacks"} document focus; Escape ${escaped ? "closes" : "doesn't close"} the dialog`);
      });
      await delay(2000);
      if (await installed()) throw new Error("Cancel installed it");
      const again = await storeButton(app, shell, desktop, window).catch(async (error) => {
        await desktopShot(t, desktop, "store-after-cancel");
        throw error;
      });
      if (!again.text.startsWith("Add to")) throw new Error(`after Cancel the listing offers ${again.text}`);
      return { button: button.text, permissions: details };
    });
    await t.check("closing the store tab while Ardia's dialog is open dismisses it and installs nothing", async () => {
      await add("store-dialog-close-tab");
      const heading = await shell.rectByText(title);
      const frame = await currentRect(desktop, window);
      await desktop.click(frame.x + heading.x, frame.y + heading.y);
      await until(() => hasFocus(shell), { timeout: 5000, label: "keyboard focus in the window with the dialog" });
      if (!(await shows(shell, title))) throw new Error("the dialog closed when its own heading was clicked, before Ctrl+W");
      await desktop.key("ctrl+w");
      await shell.waitState(`return !s.windows[windowId].tabIds.some((id) => (s.tabs[id]?.url ?? "").includes(${js(STORE_ID)})) || null;`, { timeout: 10000, label: "the store tab to close" });
      await until(async () => !(await shows(shell, title)), { timeout: 8000, label: "the dialog to close with the tab" });
      await delay(2000);
      if (await installed()) throw new Error("closing the tab installed it");
      await desktopShot(t, desktop, "store-tab-closed");
      return true;
    });
    await t.check("Add Extension installs it from the store and Settings › Extensions lists it", async () => {
      const tab = await shell.newTab(STORE_LISTING);
      await shell.waitTabUrl(tab, onListing);
      await add("store-dialog-add");
      await clickDialogButton(desktop, window, shell, title, "Add Extension");
      const ext = await until(installed, { timeout: 60000, label: "the store extension installed" });
      if (!ext.fromWebStore) throw new Error(`installed but not from the store: ${JSON.stringify(ext)}`);
      const { settings } = await openSettingsWindow(desktop, app, shell, { pane: "Extensions" });
      await settings.waitFor(`document.body.innerText.includes(${js(STORE_NAME)})`, { timeout: 10000, label: "the store extension in Settings › Extensions" });
      await desktopShot(t, desktop, "store-installed");
      return { id: ext.id, version: ext.version };
    });
    await t.stop(app);
  },
};

export default [popupDesktop, crxDesktop, storeDesktop];
