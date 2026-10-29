import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { clickTextIn, newWindow, openSettingsWindow } from "./desktopSession.mjs";
import { paneText } from "./desktopSettings.mjs";
import { until } from "./util.mjs";

const WEBKIT_EPOCH_US = 11644473600000000n;

export function freshenHistory(home, { nowMs = Date.now() } = {}) {
  const chrome = new DatabaseSync(join(home, ".config", "google-chrome", "Default", "History"));
  const rows = chrome.prepare("SELECT id FROM urls ORDER BY last_visit_time DESC").all();
  const update = chrome.prepare("UPDATE urls SET last_visit_time = ? WHERE id = ?");
  rows.forEach((row, index) => update.run(BigInt(nowMs - (index + 1) * 3600000) * 1000n + WEBKIT_EPOCH_US, row.id));
  chrome.close();
  return rows.length;
}

export const MARKS = `(() => {
  const out = {};
  const boxes = [...document.querySelectorAll('div')].filter((n) => { const r = n.getBoundingClientRect(); return r.width >= 12 && r.width <= 20 && Math.abs(r.width - r.height) < 1.5; });
  const labels = [...document.querySelectorAll('div')].filter((n) => n.children.length === 0 && (n.innerText ?? '').trim() && n.getBoundingClientRect().width > 0);
  for (const label of labels) {
    const lr = label.getBoundingClientRect();
    const box = boxes.filter((b) => { const r = b.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - (lr.top + lr.height / 2)) < 10 && r.right <= lr.left + 1 && lr.left - r.right < 70; }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    if (!box) continue;
    const m = getComputedStyle(box).backgroundColor.match(/\\d+(\\.\\d+)?/g)?.map(Number) ?? [];
    out[label.innerText.trim()] = m.length >= 3 && m[2] > 150 && m[0] < 120 && (m[3] ?? 1) > 0.5;
  }
  return out;
})()`;

export const marks = (shell) => shell.eval(MARKS, { timeout: 5000 });

export async function openImportWindow(desktop, app, shell, existing) {
  const { settings, window } = existing ?? (await openSettingsWindow(desktop, app, shell, { pane: "General" }));
  await settings.waitFor("document.body.innerText.includes('Import…')", { timeout: 10000, label: "the Import… row" });
  const known = await desktop.windows();
  await clickTextIn(desktop, window, settings, "Import…");
  const importer = await app.shell("import", { timeout: 20000 });
  const importWindow = await newWindow(desktop, known, { label: "the Import window" });
  await importer.waitFor("document.body.innerText.includes('What to import')", { timeout: 15000, label: "the Import window's first step" });
  await delay(500);
  return { settings, window, importer, importWindow };
}

export async function untilStep(importer, pattern, { timeout = 30000, label } = {}) {
  return until(async () => {
    const text = await paneText(importer);
    return pattern.test(text) ? text : false;
  }, { timeout, interval: 400, label: label ?? `the Import window to show ${pattern}` });
}

export async function continueToDone(desktop, importWindow, importer, { timeout = 60000 } = {}) {
  const seen = [];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await paneText(importer);
    if (/You're all set|Partially imported|Import failed|nothing new to import/.test(text)) return { text, seen };
    if (/didn't allow access|Waiting for password/.test(text)) return { text, seen, blocked: true };
    if (/Continue/.test(text) && !seen.includes(text.split("\n")[0]) ) {
      seen.push(text.split("\n")[0]);
      await clickTextIn(desktop, importWindow, importer, "Continue");
    }
    await delay(800);
  }
  throw new Error(`the import never reached its Done step; steps ${JSON.stringify(seen)}; now ${(await paneText(importer)).slice(0, 300)}`);
}

export const summaryLine = (text) => text.split("\n").find((line) => /^Imported |nothing new to import/.test(line)) ?? null;
