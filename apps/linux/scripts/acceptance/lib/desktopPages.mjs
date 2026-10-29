import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { connectCdp, evaluate } from "./cdp.mjs";
import { clickLabelIn, currentRect, openSettingsWindow, pointAt } from "./desktopSession.mjs";
import { makeClips, registerPages } from "./pageFixtures.mjs";
import { js, until } from "./util.mjs";

const run = promisify(execFile);

export async function hasFfmpeg() {
  return run("ffmpeg", ["-hide_banner", "-encoders"], { timeout: 10000, maxBuffer: 4 << 20 }).then(({ stdout }) => /libvpx/.test(stdout) && /libopus/.test(stdout), () => false);
}

export async function pageFixtures(t, { clips = false } = {}) {
  const made = clips ? await makeClips(await t.scratch("clips")) : null;
  return registerPages(t.fixtures, made);
}

export async function ardiaWindow(desktop, { title } = {}) {
  return until(async () => (await desktop.windows()).find((w) => w.appId === "ardia" && (!title || w.title.includes(title))) ?? false, { timeout: 15000, label: `the Ardia window${title ? ` titled ${title}` : ""}` });
}

export function paneRect(shell, tabId) {
  return shell.rect(`[data-ardia-native-tab="${tabId}"]`);
}

export async function pageSession(app, url, { timeout = 20000 } = {}) {
  return app.connect(await app.pageLoaded(url, { timeout }));
}

export async function screenPoint(desktop, window, shell, session, tabId, expression) {
  const pane = await until(() => paneRect(shell, tabId), { timeout: 8000, label: `tab ${tabId}'s pane` });
  const inner = await evaluate(session, `(() => { const n = (${expression}); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height }; })()`, { userGesture: false });
  const frame = await currentRect(desktop, window);
  return { x: frame.x + pane.left + inner.x, y: frame.y + pane.top + inner.y, rect: { x: frame.x + pane.left + inner.left, y: frame.y + pane.top + inner.top, width: inner.width, height: inner.height }, pane };
}

export async function clickInPage(desktop, window, shell, session, tabId, expression, { button = "left" } = {}) {
  const point = await screenPoint(desktop, window, shell, session, tabId, expression);
  await desktop.click(point.x, point.y, button);
  return point;
}

export async function revealToolbarWithPointer(desktop, window) {
  const frame = await currentRect(desktop, window);
  await desktop.pointerMove(frame.x + frame.width / 2, frame.y + 26);
  await delay(600);
}

export async function openSiteControls(desktop, window, shell) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await shell.labels()).includes("More Site Controls")) return;
    await revealToolbarWithPointer(desktop, window);
    await clickSmallestLabel(desktop, window, shell, "Site Controls").catch(() => {});
    if (await until(async () => (await shell.labels()).includes("More Site Controls"), { timeout: 3000, label: "the Site Controls panel" }).catch(() => false)) return;
  }
  throw new Error(`Site Controls didn't open; visible controls ${JSON.stringify(await shell.labels())}`);
}

export async function labelled(shell, label) {
  return (await shell.labels()).includes(label);
}

export async function rowControl(shell, title, { minWidth = 10, maxWidth = 80, nearest = false } = {}) {
  return shell.eval(`(() => {
    const want = ${js(title)};
    const labels = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === want && n.getBoundingClientRect().width > 0);
    const label = labels.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    if (!label) return null;
    const box = label.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const candidates = [...document.querySelectorAll('[tabindex], [role], button, input')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > ${minWidth} && r.width < ${maxWidth} && r.height > 10 && r.height < 44 && r.left > box.right && Math.abs(r.top + r.height / 2 - middle) < (${nearest} ? 40 : 24);
    });
    const control = candidates.sort((a, b) => ${nearest} ? a.getBoundingClientRect().left - b.getBoundingClientRect().left : a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!control) return null;
    const r = control.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height, checked: control.getAttribute('aria-checked') ?? control.getAttribute('aria-pressed') ?? null, text: (control.innerText ?? '').trim() };
  })()`);
}

export const rowToggle = (shell, title) => rowControl(shell, title);

export async function scrolledIntoView(desktop, window, shell, read, { label = "the control" } = {}) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = await until(read, { timeout: 10000, label });
    const height = await shell.eval("innerHeight");
    if (r.y > 30 && r.y < height - 30) return r;
    const frame = await currentRect(desktop, window);
    await desktop.pointerMove(frame.x + frame.width * 0.65, frame.y + frame.height * 0.5);
    await desktop.scroll(r.y >= height - 30 ? 3 : -3);
    await delay(250);
  }
  throw new Error(`${label} never scrolled into view`);
}

export async function clickRowToggle(desktop, window, shell, title) {
  const control = await scrolledIntoView(desktop, window, shell, () => rowToggle(shell, title), { label: `the ${title} toggle` });
  await pointAt(desktop, window, control);
  return control;
}

export async function shot(t, desktop, name) {
  await mkdir(t.evidenceDir, { recursive: true });
  return desktop.screenshot?.(join(t.evidenceDir, `${name}.png`)).catch(() => null);
}

export async function dismissTelemetryAsk(desktop, window, shell) {
  const r = await shell.rectByText("Not now", { exact: true }).catch(() => null);
  if (r) await pointAt(desktop, window, r);
}

export async function clickBlankPage(desktop, window, shell, tabId) {
  const pane = await until(() => paneRect(shell, tabId), { timeout: 8000, label: `tab ${tabId}'s pane` });
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + pane.left + pane.width * 0.8, frame.y + pane.top + pane.height * 0.8);
}

export async function ensureFocusedPage(desktop, window, shell, session, tabId) {
  await clickBlankPage(desktop, window, shell, tabId);
  await until(() => evaluate(session, "document.hasFocus()", { userGesture: false }), { timeout: 5000, label: "keyboard focus in the page" });
}

export async function missingCommands(desktop, names) {
  const missing = [];
  for (const name of names) {
    const found = await desktop.run("sh", ["-c", 'command -v "$1"', "sh", name]).then(() => true, () => false);
    if (!found) missing.push(name);
  }
  return missing;
}

export async function showAdvancedSettings(desktop, window, settings) {
  const control = await until(() => rowToggle(settings, "Show advanced settings"), { timeout: 10000, label: "the Show advanced settings toggle" });
  if (control.checked === "true") return false;
  await pointAt(desktop, window, control);
  await delay(800);
  return true;
}

export async function openSettingsRow(desktop, app, shell, pane, title) {
  const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane });
  const present = () => settings.eval(`document.body.innerText.includes(${js(title)})`);
  if (!(await until(present, { timeout: 4000, label: title }).catch(() => false))) {
    await showAdvancedSettings(desktop, window, settings);
    await settings.waitFor(`document.body.innerText.includes(${js(title)})`, { timeout: 10000, label: `${title} in Settings › ${pane} with advanced settings shown` });
  }
  return { settings, window };
}

export async function sidebarTab(shell, title) {
  return shell.eval(`(() => {
    const want = ${js(title)};
    const hits = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === want).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.left < 260 && r.top > 40);
    hits.sort((a, b) => a.width * a.height - b.width * b.height);
    const r = hits[0];
    return r ? { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 } : null;
  })()`);
}

export async function clickSidebarTab(desktop, window, shell, title) {
  const r = await until(() => sidebarTab(shell, title), { timeout: 8000, label: `the sidebar tab ${title}` });
  await pointAt(desktop, window, r);
  await delay(600);
  return r;
}

export function titledSeed(seed, titles) {
  for (const tab of Object.values(seed.tabs)) if (titles[tab.url]) tab.title = titles[tab.url];
  return seed;
}

export async function probe(app, url, expression) {
  const target = await app.pageLoaded(url, { timeout: 15000 });
  const session = await connectCdp(target.webSocketDebuggerUrl);
  try {
    return await evaluate(session, expression, { userGesture: false });
  } finally {
    await session.close().catch(() => {});
  }
}

export async function focusPageByClick(desktop, window, shell, app, url, tabId, { attempts = 3 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const pane = await until(() => paneRect(shell, tabId), { timeout: 8000, label: `tab ${tabId}'s pane` });
    const size = await probe(app, url, "({ width: innerWidth, height: innerHeight })");
    const frame = await currentRect(desktop, window);
    await desktop.click(frame.x + pane.left + Math.min(size.width, pane.width) * 0.6, frame.y + pane.top + Math.min(size.height, pane.height) * 0.85);
    const focused = await until(() => probe(app, url, "document.hasFocus()"), { timeout: 2500, label: "page focus" }).catch(() => false);
    if (focused) return attempt + 1;
  }
  throw new Error(`clicking tab ${tabId}'s page ${attempts} times never gave it keyboard focus (active tab ${await shell.activeTabId()})`);
}

export async function menuItem(shell, title, { prefix = false } = {}) {
  return shell.eval(`(() => {
    const matches = (text) => ${prefix} ? text.startsWith(${js(title)}) : text === ${js(title)};
    const row = [...document.querySelectorAll(".ardia-menu .ardia-menu-item")].find((r) => matches((r.querySelector(".ardia-menu-title")?.textContent ?? r.innerText).trim()) && r.getBoundingClientRect().width > 0);
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

export async function menuItems(shell) {
  return shell.eval(`[...document.querySelectorAll(".ardia-menu .ardia-menu-item")].map((r) => (r.querySelector(".ardia-menu-title")?.textContent ?? r.innerText).trim())`);
}

export async function clickMenuItem(desktop, window, shell, title, { prefix = false } = {}) {
  const r = await until(() => menuItem(shell, title, { prefix }), { timeout: 6000, label: `the menu item ${title}` }).catch(async (error) => { throw new Error(`${error.message}; the menu lists ${JSON.stringify(await menuItems(shell).catch(() => null))}`); });
  await pointAt(desktop, window, r);
  await delay(500);
  return r;
}

export async function expandSiteControls(desktop, window, shell) {
  await openSiteControls(desktop, window, shell);
  for (let attempt = 0; attempt < 2 && !(await shell.text()).includes("Microphone"); attempt++) {
    await clickSmallestLabel(desktop, window, shell, "More Site Controls");
    await until(async () => (await shell.text()).includes("Microphone"), { timeout: 3000, label: "the expanded Site Controls" }).catch(() => false);
  }
  if (!(await shell.text()).includes("Microphone")) throw new Error("More Site Controls didn't expand the panel");
}

export async function sitePermissionValue(shell, title) {
  return shell.eval(`(() => {
    const label = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === ${js(title)} && n.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!label) return null;
    const box = label.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const values = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && /^(Ask|Allowed|Blocked|Muted)$/.test((n.innerText ?? '').trim())).map((n) => ({ n, r: n.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && ((r.left > box.right && Math.abs(r.top + r.height / 2 - middle) < 12) || (Math.abs(r.left - box.left) < 12 && r.top >= box.bottom - 2 && r.top < box.bottom + 24)));
    const hit = values[0];
    return hit ? { value: hit.n.innerText.trim(), x: hit.r.left + hit.r.width / 2, y: hit.r.top + hit.r.height / 2 } : null;
  })()`);
}

export async function choosePanelPermission(desktop, window, shell, title, choice) {
  await expandSiteControls(desktop, window, shell);
  const value = await until(() => sitePermissionValue(shell, title), { timeout: 5000, label: `the ${title} value in Site Controls` });
  await pointAt(desktop, window, value);
  await delay(700);
  await clickMenuItem(desktop, window, shell, choice);
  return until(async () => { const now = await sitePermissionValue(shell, title); return now?.value === choice ? now : false; }, { timeout: 5000, label: `${title} to read ${choice}` });
}

export async function clickSmallestLabel(desktop, window, shell, label) {
  const r = await until(() => shell.eval(`(() => { const nodes = [...document.querySelectorAll('[aria-label],[title]')].filter((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === ${js(label)}).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.width * a.height - b.width * b.height); const r = nodes[0]; return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`), { timeout: 6000, label: `control labelled ${label}` });
  await pointAt(desktop, window, r);
  await delay(600);
  return r;
}

export async function closeSiteControls(desktop, window, shell) {
  for (let attempt = 0; attempt < 3 && (await shell.labels()).includes("More Site Controls"); attempt++) {
    await revealToolbarWithPointer(desktop, window);
    await clickSmallestLabel(desktop, window, shell, "Site Controls");
    await delay(600);
  }
  if ((await shell.labels()).includes("More Site Controls")) throw new Error("Site Controls stayed open");
}

export async function closeSettingsWindow(desktop, window, settings) {
  const gone = async () => !(await desktop.windows()).some((w) => w.id === window.id);
  if (await gone()) return;
  const button = await settings.eval(`(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].filter((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === 'Close window').map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0)[0]; return n ? { x: n.left + n.width / 2, y: n.top + n.height / 2 } : null; })()`).catch(() => null);
  if (button) await pointAt(desktop, window, button);
  else await desktop.key("ctrl+w");
  await until(gone, { timeout: 5000, label: "the Settings window to close" });
  await delay(400);
}
