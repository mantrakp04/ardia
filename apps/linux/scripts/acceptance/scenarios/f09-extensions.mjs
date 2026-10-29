import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { evaluate } from "../lib/cdp.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { js, nonce, until } from "../lib/util.mjs";

export const FIXTURE_EXTENSION = new URL("../fixtures/extension/", import.meta.url);
export const FIXTURE_NAME = "Ardia Acceptance Fixture";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function fixtureIcon(size = 32, rgba = [32, 120, 220, 255]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rows.set(rgba, y * (1 + size * 4) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

export async function prepareExtension(dir, { version } = {}) {
  await cp(FIXTURE_EXTENSION, dir, { recursive: true });
  await writeFile(join(dir, "icon.png"), fixtureIcon());
  if (version) await setVersion(dir, version);
  return dir;
}

export async function setVersion(dir, version) {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  manifest.version = version;
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

export const listed = (reply) => (reply.ok ? reply.value.extensions ?? [] : []).find((x) => x.name === FIXTURE_NAME) ?? null;

async function reply(shell, name, args) {
  const result = await shell.call(name, args);
  if (!result.ok) throw new Error(`${name} failed: ${result.code} ${result.message}`);
  return result.value;
}

async function fixtureOf(shell) {
  return until(async () => listed(await shell.call("extensions.list", {})) ?? false, { timeout: 20000, label: "the fixture extension in extensions.list" });
}

async function watchEvents(shell) {
  await shell.eval(`(() => { globalThis.__f09Events = []; globalThis.__f09Stop?.(); globalThis.__f09Stop = __ardiaHost.onEvent((module, event, payload) => { if (module === "ArdiaExtensions") globalThis.__f09Events.push(payload); }); return true; })()`);
}

const eventOf = (shell, id, kind) =>
  until(async () => (await shell.eval("globalThis.__f09Events ?? []")).find((e) => e?.name === "extensions.changed" && e.data?.id === id && e.data?.event === kind) ?? false,
    { timeout: 10000, label: `extensions.changed ${kind}` });

async function worker(app, id) {
  const target = await until(async () => (await app.targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${id}/`)) ?? false,
    { timeout: 20000, label: "the fixture's service worker" });
  return app.connect(target);
}

const reports = (session) => evaluate(session, "globalThis.fixtureReports ?? []");

export default {
  id: "F09",
  issue: 19,
  title: "Extensions management, toolbar action, popup and side panel",
  deadline: 360000,
  manual: [
    { name: "Web Store install shows Ardia's consent dialog and Cancel installs nothing", steps: ["Open chromewebstore.google.com and choose Add to Ardia on any extension.", "Ardia's own dialog lists the extension's permissions.", "Cancel: nothing is installed and the store page shows Add again.", "Add: the extension appears in Settings › Extensions and on the toolbar."], reason: "needs network access to the Chrome Web Store and its signed CRX" },
    { name: "A permission-increasing update asks before re-enabling", steps: ["Install a packed CRX from Settings › Extensions › Install from file.", "Install a newer CRX of the same key that adds a permission: Chromium disables it.", "Turning it on shows Ardia's 'needs new permissions' dialog; Cancel keeps it off, Allow turns it on."], reason: "needs two signed CRX files of the same key" },
    { name: "Popup placement, focus and keyboard", steps: ["Pin the fixture and click its toolbar button: the popup opens under the button at its own size.", "Typing goes to the popup; Escape and clicking outside close it; Close in the popup closes it."], reason: "needs a visible compositor and real input" },
  ],
  async run(t) {
    const run = nonce("f09");
    const fixture = await prepareExtension(await t.scratch("fixture-extension"));
    const second = await prepareExtension(await t.scratch("second-extension"));
    const state = await startBrowser(t, { name: "extensions", extensions: true, extraArgs: [`--load-extension=${fixture}`] });
    const { shell, app } = state;
    await watchEvents(shell);
    let ext;

    await t.check("the --load-extension fixture is listed with its action, popup and side panel", async () => {
      ext = await fixtureOf(shell);
      const problems = [];
      if (!ext.enabled || ext.state !== "ENABLED") problems.push(`state ${ext.state}`);
      if (ext.hasAction !== true || ext.popup !== "popup.html" || ext.sidePanel !== "panel.html") problems.push(`action ${JSON.stringify([ext.hasAction, ext.popup, ext.sidePanel])}`);
      if (ext.actionTitle !== "Fixture Action" || !String(ext.actionIcon).startsWith("data:image/png;base64,")) problems.push("action title or icon");
      if (ext.fromWebStore !== false || ext.webStoreUrl !== null || ext.incognitoSplit !== false) problems.push("store fields");
      if (problems.length) throw new Error(problems.join("; "));
      await until(async () => (await shell.eval(`(ardiaLinux.extensions.getState().lists[""] ?? []).some((x) => x.id === ${js(ext.id)})`)) || false,
        { timeout: 10000, label: "the fixture in the shared Extensions store" });
      return { id: ext.id, location: ext.location };
    }, { critical: true });

    await t.check("arbitrary extension calls are refused instead of forwarded", async () => {
      const unknown = await shell.call("extensions.executeScript", { id: ext.id, code: "1" });
      const malformed = await shell.call("extensions.setEnabled", { id: ext.id, enabled: "yes" });
      if (unknown.ok || malformed.ok || malformed.code !== "ERR_EXTENSION_REQUEST") throw new Error(JSON.stringify({ unknown, malformed }));
      return { unknown: unknown.code, malformed: malformed.code };
    });

    await t.check("the omnibox keyword is listed by search.engines and kept out of Ardia's search engines", async () => {
      const engines = (await reply(shell, "search.engines", {})).list.engines;
      const keyword = engines.find((e) => e.extension?.id === ext.id);
      if (!keyword || keyword.isOmniboxExtension !== true || keyword.keyword !== "ardiafixture") throw new Error(JSON.stringify(keyword ?? null));
      const mapped = await shell.state("return s.settings.extensionSearchEngines ?? [];");
      if (mapped.some((e) => e.extensionId === ext.id)) throw new Error("an omnibox keyword became a search engine");
      return { keyword: keyword.keyword };
    });

    await t.check("turning the extension off and on updates the list and announces each change", async () => {
      await reply(shell, "extensions.setEnabled", { id: ext.id, enabled: false });
      await eventOf(shell, ext.id, "disabled");
      const off = await until(async () => { const x = await fixtureOf(shell); return !x.enabled ? x : false; }, { timeout: 8000, label: "disabled in the list" });
      await reply(shell, "extensions.setEnabled", { id: ext.id, enabled: true });
      await eventOf(shell, ext.id, "enabled");
      const on = await until(async () => { const x = await fixtureOf(shell); return x.enabled ? x : false; }, { timeout: 8000, label: "enabled in the list" });
      return { off: off.state, on: on.state };
    });

    await t.check("reload picks up the edited manifest", async () => {
      await setVersion(fixture, "1.1");
      await reply(shell, "extensions.reload", { id: ext.id });
      await eventOf(shell, ext.id, "reloaded");
      const reloaded = await until(async () => { const x = await fixtureOf(shell); return x.version === "1.1" ? x : false; }, { timeout: 15000, label: "version 1.1" });
      return { version: reloaded.version };
    });

    const pageA = t.fixtures.url.page(1, `${run}-a`);
    const pageB = t.fixtures.url.page(2, `${run}-b`);
    const tabA = await shell.newTab(pageA);
    await shell.waitTabUrl(tabA, (u) => u === pageA);
    const tabB = await shell.newTab(pageB);
    await shell.waitTabUrl(tabB, (u) => u === pageB);
    const sw = await worker(app, ext.id);

    await t.check("a badge set for one tab shows only on that tab", async () => {
      await evaluate(sw, `chrome.tabs.query({ url: ${js(pageA)} }).then(([tab]) => chrome.action.setBadgeText({ tabId: tab.id, text: "7" })).then(() => true)`);
      const states = async (tabId) => (await reply(shell, "extensions.actionStates", { tabId, ids: [ext.id] }))[ext.id];
      const a = await until(async () => { const s = await states(tabA); return s?.badgeText === "7" ? s : false; }, { timeout: 8000, label: "badge on tab A" });
      const b = await states(tabB);
      if (!b || b.badgeText !== "") throw new Error(`tab B badge ${JSON.stringify(b)}`);
      if (a.title !== "Fixture Action" || !a.popup.endsWith("/popup.html") || a.enabled !== true) throw new Error(JSON.stringify(a));
      return { a: a.badgeText, b: b.badgeText };
    });

    await t.check("the toolbar action opens a real extension popup, which closes on tab switch", async () => {
      await shell.state(`s.activate(${js(tabA)}); return true;`);
      await shell.waitState(`return s.windows[windowId]?.activeTabIds?.[s.windows[windowId].profileId] === ${js(tabA)};`, { timeout: 5000, label: "tab A active" });
      await shell.eval(`(ardiaLinux.openExtension(${js(shell.windowId)}, ${js(ext.id)}, ${js(tabA)}), true)`);
      await until(async () => (await shell.eval(`ardiaLinux.extensions.getState().popup?.extensionId === ${js(ext.id)}`)) || false, { timeout: 8000, label: "the popup in the shared store" });
      const report = await until(async () => (await reports(sw)).find((r) => r.kind === "popup") ?? false, { timeout: 15000, label: "the popup page to run" });
      if (report.popupViews !== 1) throw new Error(`popup view type ${JSON.stringify(report)}`);
      await shell.state(`s.activate(${js(tabB)}); return true;`);
      await until(async () => (await shell.eval("ardiaLinux.extensions.getState().popup === null")) || false, { timeout: 8000, label: "popup closed on tab switch" });
      await until(async () => !(await app.targets()).some((x) => x.url === `chrome-extension://${ext.id}/popup.html`), { timeout: 8000, label: "the popup host destroyed" });
      return report;
    });

    await t.check("an action set to open the side panel opens it for the current tab", async () => {
      await evaluate(sw, "chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => true)");
      const url = await reply(shell, "extensions.sidePanelUrl", { tabId: tabB, extensionId: ext.id });
      if (url !== `chrome-extension://${ext.id}/panel.html`) throw new Error(`side panel URL ${url}`);
      await shell.eval(`(ardiaLinux.openExtension(${js(shell.windowId)}, ${js(ext.id)}, ${js(tabB)}), true)`);
      await until(async () => (await shell.eval(`ardiaLinux.extensions.getState().sidePanels[${js(shell.windowId)}]?.extensionId === ${js(ext.id)}`)) || false, { timeout: 8000, label: "the side panel in the shared store" });
      const report = await until(async () => (await reports(sw)).find((r) => r.kind === "panel") ?? false, { timeout: 15000, label: "the side panel page to run" });
      await evaluate(sw, "chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).then(() => true)");
      return report;
    });

    await t.check("tabs and windows an extension opens show in Ardia, and an inactive tab keeps the selection", async () => {
      const opened = (hash) => `chrome-extension://${ext.id}/opened.html#${hash}`;
      const tabsAt = (url) => shell.state(`return Object.values(s.tabs).filter((t) => t.windowId === windowId && t.url === ${js(url)}).map((t) => t.id);`);
      const shownOnce = async (url, label) => {
        const [id] = await until(async () => { const ids = await tabsAt(url); return ids.length ? ids : false; }, { timeout: 10000, label });
        await new Promise((resolve) => setTimeout(resolve, 600));
        const ids = await tabsAt(url);
        const pages = (await app.targets()).filter((x) => x.type === "page" && x.url === url);
        if (ids.length !== 1 || pages.length !== 1) throw new Error(`${label}: ${ids.length} sidebar tabs, ${pages.length} pages`);
        return id;
      };
      await shell.state(`s.activate(${js(tabA)}); return true;`);
      await evaluate(sw, "chrome.action.setPopup({ popup: '' }).then(() => true)");
      await shell.eval(`(ardiaLinux.openExtension(${js(shell.windowId)}, ${js(ext.id)}, ${js(tabA)}), true)`);
      const clicked = await shownOnce(opened("clicked"), "the action click's tab");
      await shell.waitState(`return s.windows[windowId]?.activeTabIds?.[s.windows[windowId].profileId] === ${js(clicked)};`, { timeout: 5000, label: "the clicked tab selected" });
      await evaluate(sw, "chrome.action.setPopup({ popup: 'popup.html' }).then(() => true)");
      await evaluate(sw, `chrome.tabs.create({ url: ${js(opened("background"))}, active: false }).then(() => true)`);
      const background = await shownOnce(opened("background"), "the inactive tab");
      if ((await shell.activeTabId()) !== clicked) throw new Error("an inactive extension tab took the selection");
      const known = (await app.shells()).map((s) => s.windowId);
      const created = await evaluate(sw, `chrome.windows.create({ url: ${js(opened("window"))} }).then((w) => w.id)`);
      const id = await until(async () => (await app.shells()).find((s) => s.ready && !s.utility && !known.includes(s.windowId))?.windowId ?? false,
        { timeout: 20000, label: "the extension's window renderer" });
      const other = await app.shell(id);
      const urls = await other.waitState(`const w = s.windows[windowId]; const urls = (w?.tabIds ?? []).map((t) => s.tabs[t]?.url); return urls.includes(${js(opened("window"))}) && urls;`,
        { timeout: 15000, label: "the extension's tab in its window" });
      if (urls.length !== 1) throw new Error(`the extension's window holds ${JSON.stringify(urls)}`);
      await evaluate(sw, `chrome.windows.remove(${js(created)}).then(() => true)`);
      return { clicked, background, window: urls };
    });

    let installed;
    await t.check("Load unpacked inspects and installs a folder and announces it", async () => {
      const pkg = await reply(shell, "extensions.inspectUnpacked", { path: second });
      if (pkg.name !== FIXTURE_NAME || pkg.popup !== "popup.html" || pkg.sidePanel !== "panel.html" || !String(pkg.icon).startsWith("data:image/png")) throw new Error(JSON.stringify(pkg));
      const bad = await shell.call("extensions.inspectUnpacked", { path: join(second, "missing") });
      if (bad.ok || bad.code !== "ERR_EXTENSION_INVALID") throw new Error(`missing folder ${JSON.stringify(bad)}`);
      installed = (await reply(shell, "extensions.install", { path: second })).id;
      await eventOf(shell, installed, "installed");
      return { id: installed, expected: pkg.id ?? null };
    });

    await t.check("uninstall removes the extension, its side panel and its keyword", async () => {
      await reply(shell, "extensions.uninstall", { id: ext.id });
      await eventOf(shell, ext.id, "uninstalled");
      await until(async () => !((await reply(shell, "extensions.list", {})).extensions.some((x) => x.id === ext.id)), { timeout: 8000, label: "gone from extensions.list" });
      await until(async () => (await shell.eval(`!ardiaLinux.extensions.getState().sidePanels[${js(shell.windowId)}]`)) || false, { timeout: 8000, label: "side panel closed" });
      const engines = (await reply(shell, "search.engines", {})).list.engines;
      if (engines.some((e) => e.extension?.id === ext.id)) throw new Error("the keyword outlived its extension");
      if (installed) await reply(shell, "extensions.uninstall", { id: installed });
      return true;
    });
  },
};
