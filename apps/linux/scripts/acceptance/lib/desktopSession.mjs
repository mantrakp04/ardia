import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { changedCells, changedRegion, desktopTools, missingTools, regions, startDesktop } from "./desktop.mjs";
import { startBrowser } from "./flows.mjs";
import { until } from "./util.mjs";

export const SESSION_TOOLS = { sway: ["sway", "swaymsg", "python", "xkbcli", "dbusDaemon"], x11: ["xvfb", "xdotool", "openbox", "xprop", "dbusDaemon"] };
const SESSION_KEYS = ["WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "GTK_IM_MODULE", "QT_IM_MODULE", "XMODIFIERS"];
const OWNER_KEYS = ["SWAYSOCK", "I3SOCK", "HYPRLAND_INSTANCE_SIGNATURE", "XDG_SESSION_ID", "XDG_SEAT", "XDG_VTNR", "XAUTHORITY", "GNOME_KEYRING_CONTROL", "SSH_AUTH_SOCK", "AT_SPI_BUS_ADDRESS", "PULSE_SERVER", "PIPEWIRE_REMOTE", "WAYLAND_SOCKET"];
export const SOFTWARE_GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
let cachedTools = null;

export async function sessionTools() {
  cachedTools ??= desktopTools();
  return cachedTools;
}

export async function desktopUnavailable({ x11 = false, needs = [] } = {}) {
  const tools = await sessionTools();
  const missing = missingTools(tools, [...(x11 ? SESSION_TOOLS.x11 : SESSION_TOOLS.sway), ...needs]);
  if (missing.length) return `${missing.join(", ")} not found; install them (see "Desktop sessions" in docs/linux-acceptance.md)`;
  return null;
}

export async function openDesktop(t, { x11 = false, outputs = 1, name, ...options } = {}) {
  const tools = await sessionTools();
  const dir = await t.scratch(name ?? (x11 ? "x11" : "sway"));
  const desktop = await startDesktop(dir, { tools, outputs, x11, ...options });
  t.defer(() => desktop.stop());
  return desktop;
}

export function sessionEnvironment(desktop, extra = {}) {
  const env = {};
  for (const key of SESSION_KEYS) env[key] = desktop.env[key];
  for (const key of OWNER_KEYS) env[key] = undefined;
  if (desktop.kind === "x11") env.WAYLAND_DISPLAY = undefined;
  else env.DISPLAY = undefined;
  return { ...env, ...extra };
}

export function desktopLaunch(desktop, { env = {}, extraArgs = [], background = false } = {}) {
  return { background, ozone: desktop.kind === "x11" ? "x11" : "wayland", env: sessionEnvironment(desktop, env), extraArgs: [...SOFTWARE_GL, ...extraArgs] };
}

export async function startDesktopBrowser(t, desktop, { env, extraArgs, background, ...options } = {}) {
  return startBrowser(t, { ...options, ...desktopLaunch(desktop, { env, extraArgs, background }) });
}

export const hasFocus = (shell) => shell.eval("document.hasFocus()", { timeout: 3000 }).catch(() => false);

export function commandBarText(shell) {
  return shell.eval("(() => { const a = document.activeElement; const fields = [...document.querySelectorAll('input, textarea, [contenteditable=true]')].map((n) => n.value ?? n.textContent ?? ''); return { active: a ? (a.value ?? a.textContent ?? '') : null, tag: a?.tagName ?? null, fields: fields.filter(Boolean) }; })()", { timeout: 3000 });
}

export async function waitTyped(shell, text, { timeout = 8000 } = {}) {
  return until(async () => {
    const state = await commandBarText(shell);
    return state.active?.includes(text) ? state : false;
  }, { timeout, label: `"${text}" in the window's focused field` });
}

export async function waitFocused(desktop, test, { timeout = 10000, label = "the focused window" } = {}) {
  return until(async () => {
    const focused = await desktop.focused();
    return focused && test(focused) ? focused : false;
  }, { timeout, label }).catch(async (error) => {
    const windows = await desktop.windows().catch(() => []);
    throw new Error(`${error.message}; focused ${JSON.stringify((await desktop.focused().catch(() => null))?.title ?? null)}, windows ${JSON.stringify(windows.map((w) => ({ id: w.id, title: w.title, focused: w.focused, rect: w.rect })))}`);
  });
}

export async function newWindow(desktop, known, { timeout = 15000, label = "a new compositor window" } = {}) {
  return until(async () => (await desktop.windows()).find((w) => !known.some((k) => k.id === w.id)) ?? false, { timeout, label });
}

export async function clickShell(desktop, window, shell, selector) {
  const r = await until(() => shell.rect(selector), { timeout: 8000, label: `visible ${selector}` });
  await pointAt(desktop, window, r);
  return r;
}

export async function desktopShot(t, desktop, name) {
  if (!desktop.screenshot) return null;
  await mkdir(t.evidenceDir, { recursive: true });
  return desktop.screenshot(join(t.evidenceDir, `${name}.png`)).catch(() => null);
}

export async function currentRect(desktop, window) {
  const fresh = window?.id !== undefined ? (await desktop.windows()).find((w) => w.id === window.id) : null;
  return (fresh ?? window).rect;
}

export async function pointAt(desktop, window, rect) {
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + rect.x, frame.y + rect.y);
  return rect;
}

export async function settledRect(read, { timeout = 8000, label = "a settled position" } = {}) {
  let last = null;
  return until(async () => {
    const r = await read();
    const same = r && last && Math.abs(r.x - last.x) < 1 && Math.abs(r.y - last.y) < 1;
    last = r;
    return same ? r : false;
  }, { timeout, interval: 250, label });
}

export async function clickTextIn(desktop, window, shell, text, { exact = true, timeout = 8000 } = {}) {
  const r = await settledRect(() => shell.rectByText(text, { exact }), { timeout, label: `visible text ${text} at a settled position` });
  return pointAt(desktop, window, r);
}

export async function clickLabelIn(desktop, window, shell, label, { timeout = 8000 } = {}) {
  const r = await until(() => shell.eval(`(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].find((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === ${JSON.stringify(label)} && n.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`), { timeout, label: `control labelled ${label}` });
  return pointAt(desktop, window, r);
}

export async function focusShellWindow(desktop, shell, window) {
  if (await hasFocus(shell)) return;
  const focused = await desktop.focused();
  if (focused?.id !== window.id) await desktop.raise(window);
  await until(async () => (await desktop.focused())?.id === window.id, { timeout: 5000, label: `${window.title} focused in the compositor` }).catch(async (error) => {
    await desktop.screenshot?.(join(desktop.dir, `focus-failure-${Date.now()}.png`)).catch(() => null);
    throw new Error(`${error.message}; windows ${JSON.stringify((await desktop.windows()).map((w) => ({ id: w.id, title: w.title, focused: w.focused })))}`);
  });
  if (await until(() => hasFocus(shell), { timeout: 800, label: "document focus" }).catch(() => false)) return;
  const field = await visibleField(shell);
  if (!field) throw new Error(`no visible field to click in ${shell.windowId}`);
  await pointAt(desktop, window, field);
  await until(() => hasFocus(shell), { timeout: 5000, label: `document focus after clicking a field in ${shell.windowId}` });
  await desktop.key("escape");
  await delay(200);
}

export async function visibleField(shell) {
  return shell.eval("(() => { const n = [...document.querySelectorAll('input, textarea')].find((n) => { const r = n.getBoundingClientRect(); if (r.width < 40 || r.height < 10) return false; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === n || n.contains(hit) || hit?.contains(n); }); if (n) { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } const url = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^[a-z0-9.-]+\\.[a-z]{2,}(:\\d+)?$/.test((e.textContent ?? '').trim()) && e.getBoundingClientRect().top < 60 && e.getBoundingClientRect().width > 0); if (!url) return null; const r = url.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()", { timeout: 3000 }).catch(() => null);
}

export async function openSettingsWindow(desktop, app, shell, { pane } = {}) {
  const from = await until(() => desktop.focused(), { timeout: 15000, label: "a focused window in the compositor" });
  await focusShellWindow(desktop, shell, from);
  const known = await desktop.windows();
  await desktop.key("ctrl+comma");
  const settings = await app.shell("settings", { timeout: 20000 });
  let reused = false;
  const window = await newWindow(desktop, known, { label: "the Settings window in the compositor" }).catch(async () => {
    reused = true;
    return (await desktop.windows()).find((w) => /Settings/.test(w.title));
  });
  if (!window) throw new Error("no Settings window in the compositor");
  if (pane) await clickTextIn(desktop, window, settings, pane);
  return { settings, window, reused };
}

export const PROMPT_DIFF = { fill: 0.06, gap: 4 };
export const PROMPT_MIN = { width: 250, height: 120 };
export const promptLike = (region) => !!region && region.width >= PROMPT_MIN.width && region.height >= PROMPT_MIN.height && region.width < 1000 && region.height < 700;

export async function stableCapture(desktop, { timeout = 20000, quiet = 2 } = {}) {
  let previous = await desktop.capture();
  let still = 0;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await delay(500);
    const next = await desktop.capture();
    const change = changedRegion(previous, next);
    previous = next;
    still = !change || change.width * change.height < 64 * 64 ? still + 1 : 0;
    if (still >= quiet) return next;
  }
  throw new Error("the screen never settled before the shortcut");
}

export async function promptAfter(desktop, act, { settle = 1200 } = {}) {
  const before = await stableCapture(desktop);
  await act();
  await delay(settle);
  const after = await desktop.capture();
  const found = regions(changedCells(before, after, PROMPT_DIFF), PROMPT_DIFF);
  return { region: found[0] ?? null, all: found.slice(0, 5), before, after };
}

export async function pressInPrompt(desktop, region, keys) {
  await desktop.click(region.x + 60, region.y + 30);
  await delay(200);
  for (const key of keys) {
    await desktop.key(key);
    await delay(150);
  }
}

export function inside(inner, outer) {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}
