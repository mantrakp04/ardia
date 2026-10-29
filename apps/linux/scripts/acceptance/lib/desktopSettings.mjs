import { setTimeout as delay } from "node:timers/promises";
import { clickTextIn, currentRect, pointAt } from "./desktopSession.mjs";
import { js, until } from "./util.mjs";

export const REAUTH_ACTION = "dev.ardia.linux.reauthenticate";

export const paneText = (shell) => shell.eval("document.body.innerText", { timeout: 3000 });

export async function paneLines(shell) {
  return (await paneText(shell)).split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function prompts(polkit) {
  return (await polkit.calls()).filter((call) => call.action === REAUTH_ACTION && call.flags & 1);
}

export async function nextPrompt(polkit, before, { timeout = 10000, label = "a polkit CheckAuthorization with user interaction" } = {}) {
  return until(async () => (await prompts(polkit))[before] ?? false, { timeout, label });
}

export async function rowControl(shell, title) {
  return shell.eval(`(() => {
    const want = ${js(title)};
    const labels = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === want && n.getBoundingClientRect().width > 0);
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

export async function showAdvanced(desktop, window, settings, marker) {
  const shown = async () => (await paneText(settings)).includes(marker);
  for (let attempt = 0; attempt < 3 && !(await shown()); attempt++) {
    const toggle = await until(() => rowControl(settings, "Show advanced settings"), { timeout: 8000, label: "the Show advanced settings toggle" });
    await pointAt(desktop, window, toggle);
    await until(shown, { timeout: 5000, label: `${marker} after showing advanced settings` }).catch(() => false);
  }
  if (!(await shown())) throw new Error(`${marker} never appeared after showing advanced settings`);
}

export async function openPane(desktop, window, settings, pane, marker) {
  await clickTextIn(desktop, window, settings, pane);
  if (marker) await settings.waitFor(`document.body.innerText.includes(${js(marker)})`, { timeout: 10000, label: `the ${pane} pane` });
  await delay(300);
}

export async function fieldRect(shell, { type, value, index = 0 } = {}) {
  return shell.eval(`(() => {
    const fields = [...document.querySelectorAll('input, textarea')].filter((n) => {
      const r = n.getBoundingClientRect();
      if (r.width < 20 || r.height < 8) return false;
      if (${js(type ?? null)} && n.type !== ${js(type ?? null)}) return false;
      if (${js(value ?? null)} !== null && n.value !== ${js(value ?? null)}) return false;
      return true;
    });
    const n = fields[${index}];
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, type: n.type, value: n.type === 'password' ? null : n.value };
  })()`);
}

export async function typeInto(desktop, window, shell, field, text) {
  await pointAt(desktop, window, field);
  await delay(200);
  await desktop.key("ctrl+a");
  await delay(100);
  await desktop.type(text);
  await delay(300);
}

export async function buttonNear(shell, row, button) {
  return shell.eval(`(() => {
    const leaf = (t) => [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === t && n.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    const label = leaf(${js(row)})[0];
    if (!label) return null;
    const ly = label.getBoundingClientRect().top + label.getBoundingClientRect().height / 2;
    const seen = new Set();
    const buttons = leaf(${js(button)}).filter((n) => { const k = Math.round(n.getBoundingClientRect().top); if (seen.has(k)) return false; seen.add(k); return true; });
    const best = buttons.sort((a, b) => Math.abs(a.getBoundingClientRect().top - ly) - Math.abs(b.getBoundingClientRect().top - ly))[0];
    if (!best || Math.abs(best.getBoundingClientRect().top + best.getBoundingClientRect().height / 2 - ly) > 60) return null;
    const r = best.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

export async function scrollToText(desktop, window, shell, text, { attempts = 80, step = 15 } = {}) {
  let last = null;
  let still = 0;
  for (let i = 0; i < attempts; i++) {
    const r = await shell.rectByText(text, { exact: true });
    const height = await shell.eval("innerHeight");
    if (r && r.y > 60 && r.y < height - 60) return r;
    still = r && last && Math.abs(r.y - last.y) < 1 ? still + 1 : 0;
    last = r;
    const frame = await currentRect(desktop, window);
    if (still >= 3) {
      await desktop.click(frame.x + frame.width * 0.6, frame.y + 30);
      await delay(200);
      await desktop.key(r && r.y <= 60 ? "prior" : "next");
      still = 0;
    }
    await desktop.pointerMove(frame.x + frame.width * 0.6, frame.y + frame.height / 2);
    await delay(50);
    await desktop.scroll(r && r.y <= 60 ? -step : step);
    await delay(250);
  }
  throw new Error(`${text} never scrolled into view (last at ${JSON.stringify(last)})`);
}
