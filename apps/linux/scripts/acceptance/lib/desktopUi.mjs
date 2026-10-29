import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "./cdp.mjs";
import { changedRegion, writePpm } from "./desktop.mjs";
import { currentRect, hasFocus, newWindow, stableCapture } from "./desktopSession.mjs";
import { js, until } from "./util.mjs";

export const MENU_DIFF = { fill: 0.06, gap: 2 };

export async function pageOrigin(shell) {
  const r = await until(() => shell.rect("[data-ardia-native-tab]"), { timeout: 8000, label: "the page area in the window" });
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export async function pageElementRect(session, selector) {
  return until(() => evaluate(session, `(() => { const n = document.querySelector(${js(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height } : null; })()`, { timeout: 3000, userGesture: false }), { timeout: 10000, label: `${selector} in the page` });
}

export async function pagePoint(desktop, window, shell, session, selector) {
  const frame = await currentRect(desktop, window);
  const origin = await pageOrigin(shell);
  const r = await pageElementRect(session, selector);
  return { x: frame.x + origin.x + r.x, y: frame.y + origin.y + r.y };
}

export function exactBox(before, after, near, { threshold = 30, pad = 24 } = {}) {
  const x0 = Math.max(0, near.x - pad);
  const y0 = Math.max(0, near.y - pad);
  const x1 = Math.min(after.width, near.x + near.width + pad);
  const y1 = Math.min(after.height, near.y + near.height + pad);
  const rows = new Uint32Array(y1 - y0);
  const columns = new Uint32Array(x1 - x0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * after.width + x) * 3;
      if (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2]) >= threshold) {
        rows[y - y0]++;
        columns[x - x0]++;
      }
    }
  }
  const dense = (counts, length) => {
    const need = Math.max(3, Math.floor(length * 0.3));
    let first = -1;
    let last = -1;
    counts.forEach((count, index) => {
      if (count >= need) {
        if (first < 0) first = index;
        last = index;
      }
    });
    return first < 0 ? null : [first, last];
  };
  const ys = dense(rows, Math.min(x1 - x0, near.width));
  const xs = dense(columns, Math.min(y1 - y0, near.height));
  if (!xs || !ys) return null;
  return { x: x0 + xs[0], y: y0 + ys[0], width: xs[1] - xs[0] + 1, height: ys[1] - ys[0] + 1 };
}

export async function surfaceAfter(desktop, act, { settle = 1500, options = MENU_DIFF, quiet = 2 } = {}) {
  const before = await stableCapture(desktop, { quiet });
  await act();
  await delay(settle);
  const after = await desktop.capture();
  const region = changedRegion(before, after, options);
  const box = region ? exactBox(before, after, region) : null;
  return { region, box, before, after };
}

export async function saveCapture(t, name, image) {
  await mkdir(t.evidenceDir, { recursive: true });
  const file = join(t.evidenceDir, `${name}.ppm`);
  await writePpm(file, image);
  return file;
}

export async function chooseMenuItem(desktop, index) {
  for (let i = 0; i < index; i++) {
    await desktop.key("down");
    await delay(120);
  }
  await desktop.key("return");
}

export async function pageMenuIndex(session, item) {
  const { currentIndex, entries } = await session.send("Page.getNavigationHistory");
  const lead = (currentIndex > 0 ? 1 : 0) + (currentIndex < entries.length - 1 ? 1 : 0);
  const order = ["Reload", "Save as…", "Print…"];
  if (!order.includes(item)) throw new Error(`unknown page menu item ${item}`);
  return lead + order.indexOf(item) + 1;
}

export async function rightClickMenu(desktop, point, { settle = 1500 } = {}) {
  const found = await surfaceAfter(desktop, () => desktop.click(point.x, point.y, "right"), { settle });
  const region = found.region;
  if (!region || region.width < 150 || region.height < 80) throw new Error(`no native menu appeared near ${JSON.stringify(point)}: change ${JSON.stringify(region)}`);
  if (point.x < region.x - 24 || point.x > region.x + region.width + 24 || point.y < region.y - 24 || point.y > region.y + region.height + 24) throw new Error(`the change ${JSON.stringify(region)} is not at the click ${JSON.stringify(point)}`);
  return found;
}

export async function clickNeutral(desktop, window, shell) {
  const frame = await currentRect(desktop, window);
  const sidebar = await shell.rect("[data-ardia-native-tab]").then((r) => r?.left ?? null, () => null);
  const point = { x: frame.x + Math.max(20, (sidebar ?? 190) / 2), y: frame.y + Math.round(frame.height * 0.6) };
  for (let clicks = 1; clicks <= 2; clicks++) {
    await desktop.click(point.x, point.y);
    if (await until(() => hasFocus(shell), { timeout: 2500, label: "document focus" }).catch(() => false)) return { clicks };
  }
  throw new Error(`no document focus in ${shell.windowId} after two clicks on its empty sidebar`);
}

export async function labelRect(shell, label) {
  return until(() => shell.eval(`(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].find((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === ${js(label)} && n.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`), { timeout: 10000, label: `control labelled ${label}` });
}

export async function rowToggle(shell, prefix) {
  return shell.eval(`(() => {
    const want = ${js(prefix)};
    const labels = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim().startsWith(want) && n.getBoundingClientRect().width > 0);
    const label = labels.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    if (!label) return null;
    const box = label.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const candidates = [...document.querySelectorAll('[tabindex], [role], button, input')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 10 && r.width < 80 && r.height > 10 && r.height < 40 && r.left > box.right && Math.abs(r.top + r.height / 2 - middle) < 24;
    });
    const control = candidates.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!control) return null;
    const r = control.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  })()`);
}

export async function shellLines(shell) {
  return (await shell.text()).split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function openedWindow(desktop, app, known, knownShells, { label = "the new window", timeout = 20000 } = {}) {
  const window = await newWindow(desktop, known, { label: `${label} in the compositor`, timeout });
  const id = await until(async () => (await app.shells()).find((s) => s.ready && !knownShells.includes(s.windowId))?.windowId ?? false, { timeout, label: `${label}'s renderer`, abort: () => app.exitReason() });
  return { window, shell: await app.shell(id, { timeout }) };
}

export async function everyWindowIsArdia(desktop, app) {
  const windows = await desktop.windows();
  const shells = (await app.shells()).filter((s) => s.ready);
  const foreign = windows.filter((w) => w.appId && w.appId !== "ardia");
  if (foreign.length) throw new Error(`a non-Ardia window appeared: ${JSON.stringify(foreign.map((w) => [w.appId, w.title]))}`);
  if (windows.length !== shells.length) throw new Error(`${windows.length} compositor windows but ${shells.length} Ardia shells: ${JSON.stringify(windows.map((w) => w.title))}`);
  return { windows: windows.length };
}

export async function networkReachable(url, { timeout = 8000 } = {}) {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeout) });
    return response.status < 500 ? null : `${url} answered ${response.status}`;
  } catch (error) {
    return `${url} is not reachable (${error.cause?.code ?? error.message})`;
  }
}

export function pixel(image, x, y) {
  const i = (Math.round(y) * image.width + Math.round(x)) * 3;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

export function whiteBox(image, seed, { inset = 4, floor = 250 } = {}) {
  const white = (x, y) => x >= 0 && y >= 0 && x < image.width && y < image.height && pixel(image, x, y).every((c) => c >= floor);
  if (!white(seed.x, seed.y)) return null;
  let left = seed.x;
  while (white(left - 1, seed.y)) left--;
  let right = seed.x;
  while (white(right + 1, seed.y)) right++;
  const column = left + inset;
  let top = seed.y;
  while (white(column, top - 1)) top--;
  let bottom = seed.y;
  while (white(column, bottom + 1)) bottom++;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export async function openSettingsRow(desktop, window, settings, name) {
  const row = await until(() => settings.eval(`(() => { const rows = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').includes(${js(name)}) && n.getBoundingClientRect().width > 400 && n.getBoundingClientRect().height < 120 && n.getBoundingClientRect().height > 30); const row = rows.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]; if (!row) return null; const r = row.getBoundingClientRect(); return { x: r.right - 18, y: r.top + r.height / 2 }; })()`), { timeout: 8000, label: `the ${name} row` });
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + row.x, frame.y + row.y);
  return row;
}

export async function removeExtensionInSettings(desktop, window, settings, name, gone) {
  let button = null;
  for (let attempt = 0; attempt < 2 && !button; attempt++) {
    await openSettingsRow(desktop, window, settings, name);
    button = await until(() => settings.rectByText("Remove Extension…"), { timeout: 5000, label: "Remove Extension… on the extension's page" }).catch(() => null);
  }
  if (!button) throw new Error(`clicking the ${name} row twice didn't open its page`);
  const frame = await currentRect(desktop, window);
  const { region } = await surfaceAfter(desktop, () => desktop.click(frame.x + button.x, frame.y + button.y), { settle: 1500 });
  if (!region || region.width < 200 || region.height < 80) throw new Error(`no Remove confirmation appeared: change ${JSON.stringify(region)}`);
  await desktop.click(region.x + 40, region.y + 24);
  await delay(300);
  await desktop.key("return");
  await until(gone, { timeout: 10000, label: `${name} removed after confirming` });
  return region;
}

export async function clickDialogButton(desktop, window, shell, title, label) {
  const r = await until(() => shell.eval(`(() => {
    const heading = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === ${js(title)} && n.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!heading) return null;
    const h = heading.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === ${js(label)} && n.children.length <= 1 && n.getBoundingClientRect().width > 0).map((n) => n.getBoundingClientRect()).filter((r) => r.top > h.top && r.top - h.bottom < 200 && Math.abs(r.left - h.left) < 400);
    const b = buttons.sort((a, c) => a.width * a.height - c.width * c.height)[0];
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  })()`), { timeout: 8000, label: `${label} in the ${title} dialog` });
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + r.x, frame.y + r.y);
}

export async function openDownloadsPopover(desktop, window, shell) {
  const labels = await shell.labels();
  const label = labels.find((l) => /^Downloads/.test(l));
  if (!label) throw new Error(`no Downloads button in ${shell.windowId}: ${JSON.stringify(labels)}`);
  const button = await labelRect(shell, label);
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + button.x, frame.y + button.y);
  return label;
}
