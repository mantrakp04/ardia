import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clickLabelIn, clickTextIn, desktopShot, desktopUnavailable, openDesktop, openSettingsWindow, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { startKeyring } from "../lib/desktopKeyring.mjs";
import { startPolkit, startPortal } from "../lib/desktopServices.mjs";
import { fieldRect, nextPrompt, openPane, paneLines, paneText, prompts, showAdvanced, typeInto } from "../lib/desktopSettings.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";
import { fixtureSecret } from "../lib/fixtureSecrets.mjs";

const ORIGIN = "https://secure.ardia.test";
const HOST = "secure.ardia.test";
const USER = "acceptance-user";
const SECRET = fixtureSecret("acceptance-");
const CARD = "4111111111111111";
const GRANT_MS = 5 * 60_000;
const PROMPT_TIMEOUT_MS = 120_000;
const REFUSALS = ["deny", "dismiss", "hang"];

const exists = (path) => stat(path).then(() => true, () => false);

async function credentialDesktop(t, name) {
  const desktop = await openDesktop(t, { name });
  const polkit = await startPolkit(desktop, { mode: "allow" });
  const portal = await startPortal(desktop);
  const { app, shell } = await startDesktopBrowser(t, desktop, { name, session: sessionSeed() });
  const saved = await shell.invoke("ArdiaPasswords.save", { args: ["", ORIGIN, USER, SECRET] });
  if (!saved.ok) throw new Error(`seeding a password failed: ${JSON.stringify(saved)}`);
  const card = await shell.invoke("ArdiaAutofill.saveCard", { args: ["", { name: "Ada", expMonth: 4, expYear: 2031 }, CARD] });
  if (!card.ok) throw new Error(`seeding a card failed: ${JSON.stringify(card)}`);
  const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Passwords" });
  await showAdvanced(desktop, window, settings, "Export CSV…");
  return { desktop, polkit, portal, app, shell, settings, window };
}

async function unlock(env) {
  const { desktop, window, settings, polkit } = env;
  await polkit.call("SetMode", ["allow"]);
  const before = (await prompts(polkit)).length;
  await clickTextIn(desktop, window, settings, "Unlock");
  await nextPrompt(polkit, before);
  await settings.waitFor(`document.body.innerText.includes(${JSON.stringify(USER)})`, { timeout: 15000, label: "the unlocked password list" });
  return Date.now();
}

async function answered(polkit, mode, before) {
  const call = await nextPrompt(polkit, before);
  if (mode !== "hang") return { call, waitedMs: 0 };
  const started = Date.now();
  await until(async () => (await polkit.calls()).some((c) => c.cancel === call.cancellation), { timeout: PROMPT_TIMEOUT_MS + 30000, interval: 1000, label: "CancelCheckAuthorization after the prompt timeout" });
  const waitedMs = Date.now() - started;
  if (waitedMs < PROMPT_TIMEOUT_MS - 10000) throw new Error(`cancelled after ${waitedMs} ms, before the two-minute prompt timeout`);
  return { call, waitedMs };
}

const exportStatus = async (settings) => {
  const lines = await paneLines(settings);
  const at = lines.indexOf("Export passwords");
  return at >= 0 ? lines[at + 1] : null;
};

async function exportOnce(env, folder, mode) {
  const { desktop, window, settings, polkit, portal } = env;
  const target = join(folder, `${mode}.csv`);
  await polkit.call("SetMode", [mode]);
  await portal.pick("SaveFile", [target]);
  const saves = (await portal.calls()).filter((c) => c.method === "SaveFile").length;
  const before = (await prompts(polkit)).length;
  await clickTextIn(desktop, window, settings, "Export CSV…");
  const save = await until(async () => (await portal.calls()).filter((c) => c.method === "SaveFile")[saves] ?? false, { timeout: 15000, label: "the portal's SaveFile request" });
  const { call, waitedMs } = await answered(polkit, mode, before);
  if (call.at < save.at) throw new Error("polkit was asked before the save dialog answered");
  await delay(1500);
  return { target, save, call, waitedMs, status: await exportStatus(settings) };
}

async function revealCardOnce(env, mode) {
  const { desktop, window, settings, polkit } = env;
  await polkit.call("SetMode", [mode]);
  const before = (await prompts(polkit)).length;
  await clickLabelIn(desktop, window, settings, "Show Card Number");
  const { waitedMs } = await answered(polkit, mode, before);
  await delay(1200);
  const values = await settings.eval("[...document.querySelectorAll('input')].map((n) => n.value)");
  const text = await paneText(settings);
  return { waitedMs, shown: values.some((v) => v.replace(/\D/g, "") === CARD), masked: text.includes("•••• •••• •••• 1111") };
}

async function openCardSheet(env) {
  const { desktop, window, settings } = env;
  await openPane(desktop, window, settings, "Autofill", "Credit Cards");
  await clickTextIn(desktop, window, settings, "Visa •••• 1111");
  await settings.waitFor("document.body.innerText.includes('Card Number')", { timeout: 10000, label: "the card sheet" });
  await until(() => settings.eval("[...document.querySelectorAll('[aria-label],[title]')].some((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === 'Show Card Number' && n.getBoundingClientRect().width > 0)"), { timeout: 8000, label: "the Show Card Number button" });
}

async function closeSheet(env, button, marker) {
  await clickTextIn(env.desktop, env.window, env.settings, button);
  await until(async () => !(await paneText(env.settings)).includes(marker), { timeout: 5000, label: "the sheet to close" });
}

async function openPasswordSheet(env) {
  const { desktop, window, settings } = env;
  await clickTextIn(desktop, window, settings, HOST);
  await settings.waitFor("document.body.innerText.includes('Website') && document.body.innerText.includes('Edit')", { timeout: 15000, label: "the password sheet" });
}

async function editPassword(env, password) {
  const { desktop, window, settings } = env;
  await clickTextIn(desktop, window, settings, "Edit");
  const field = await until(() => fieldRect(settings, { type: "password" }), { timeout: 8000, label: "the password field" });
  await typeInto(desktop, window, settings, field, password);
  await clickTextIn(desktop, window, settings, "Save");
}

async function revealed(env) {
  await env.polkit.call("SetMode", ["allow"]);
  const reply = await env.shell.invoke("ArdiaPasswords.reveal", { args: ["", ORIGIN, USER] });
  return reply.ok ? reply.value?.password : `error ${reply.message}`;
}

async function refusedEdit(t, mode) {
  const env = await credentialDesktop(t, `edit-${mode}`);
  try {
    const unlockedAt = await unlock(env);
    await until(() => Date.now() - unlockedAt > GRANT_MS + 5000, { timeout: GRANT_MS + 60000, interval: 1000, label: "the five-minute grant to run out" });
    await env.polkit.call("SetMode", ["deny"]);
    const opened = (await prompts(env.polkit)).length;
    await openPasswordSheet(env);
    await nextPrompt(env.polkit, opened, { label: "the reveal prompt after the grant ran out" });
    await delay(800);
    if ((await paneText(env.settings)).includes(SECRET)) throw new Error("a denied reveal showed the password");
    await env.polkit.call("SetMode", [mode]);
    const before = (await prompts(env.polkit)).length;
    await editPassword(env, `edited-${mode}`);
    const { waitedMs } = await answered(env.polkit, mode, before);
    await delay(1500);
    await desktopShot(t, env.desktop, `edit-${mode}`);
    const list = await env.shell.invoke("ArdiaPasswords.list", { args: [""] });
    const now = await revealed(env);
    if (now !== SECRET) throw new Error(`the password is ${JSON.stringify(now)} after a ${mode} answer to Save`);
    return { mode, waitedMs, logins: list.ok ? list.value.map((p) => p.username) : list, password: "unchanged" };
  } finally {
    await t.stop(env.app);
    await env.desktop.stop();
  }
}

export default {
  id: "F07A",
  issue: 17,
  desktop: true,
  title: "Export CSV…, Edit and Show Card Number each go through the mocked polkit authority: refusals reveal, save and write nothing; allow exports a 0600 file; the grant runs out after five minutes",
  deadline: 900000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    if (missing) {
      t.manual("System authentication gates reveal, edit, export and card numbers", ["Export CSV… asks for a path, then always prompts, and leaves a 0600 file; a card number always prompts; after five minutes opening a password prompts again."], missing);
      t.manual("Denied, dismissed and timed-out prompts never reveal", ["Deny, dismiss and leave open the prompt from Edit, Export and Show Card Number: nothing is saved, written or shown."], missing);
      return;
    }
    const edits = Object.fromEntries(REFUSALS.map((mode) => [mode, refusedEdit(t, mode).then((value) => ({ value }), (error) => ({ error }))]));
    const env = await credentialDesktop(t, "export");
    const folder = await t.scratch("exports");
    const unlockedAt = await unlock(env);
    for (const mode of REFUSALS) {
      await t.check(`Export CSV… asks for a path, then polkit; a ${mode} answer writes nothing`, async () => {
        const result = await exportOnce(env, folder, mode);
        if (await exists(result.target)) throw new Error(`${result.target} was written`);
        if (/^Saved to/.test(result.status ?? "")) throw new Error(`the pane says ${result.status}`);
        return { title: result.save.title, currentName: result.save.options.current_name, waitedMs: result.waitedMs, status: result.status, files: await readdir(folder) };
      }, { timeout: 200000 });
    }
    await t.check("Export CSV… with an allowed prompt, still inside the unlock grant, prompts again and writes a 0600 CSV with the login", async () => {
      const result = await exportOnce(env, folder, "allow");
      const info = await stat(result.target);
      const body = await readFile(result.target, "utf8");
      if ((info.mode & 0o777) !== 0o600) throw new Error(`mode ${(info.mode & 0o777).toString(8)}`);
      if (!body.includes(`${HOST},${ORIGIN}/,${USER},${SECRET}`)) throw new Error(`the CSV lacks the login: ${body}`);
      if (!/^Saved to/.test(result.status ?? "")) throw new Error(`the pane says ${result.status}`);
      return { mode: "600", lines: body.trim().split("\n").length, status: result.status, sinceUnlockMs: Date.now() - unlockedAt };
    });
    await openCardSheet(env);
    for (const mode of REFUSALS) {
      await t.check(`Show Card Number with a ${mode} answer keeps the number masked`, async () => {
        const result = await revealCardOnce(env, mode);
        if (result.shown || !result.masked) throw new Error(JSON.stringify(result));
        return result;
      }, { timeout: 200000 });
    }
    await t.check("Show Card Number with an allowed prompt shows the number, and asks again the next time", async () => {
      const first = await revealCardOnce(env, "allow");
      if (!first.shown) throw new Error(`not shown: ${JSON.stringify(first)}`);
      await desktopShot(t, env.desktop, "card-number");
      await closeSheet(env, "Cancel", "Card Number");
      await openCardSheet(env);
      const second = await revealCardOnce(env, "allow");
      if (!second.shown) throw new Error(`the second reveal: ${JSON.stringify(second)}`);
      return { first, second };
    }, { timeout: 60000 });
    await t.check("opening a password more than five minutes after unlocking asks again; Edit › Save inside the new grant saves without another prompt", async () => {
      await closeSheet(env, "Cancel", "Card Number");
      await openPane(env.desktop, env.window, env.settings, "Passwords", "Import CSV…");
      if (!(await paneText(env.settings)).includes(USER)) throw new Error(`the list relocked before the grant check: ${(await paneLines(env.settings)).slice(-6)}`);
      await until(() => Date.now() - unlockedAt > GRANT_MS + 5000, { timeout: GRANT_MS + 60000, interval: 1000, label: "five minutes since unlocking" });
      await env.polkit.call("SetMode", ["allow"]);
      const before = (await prompts(env.polkit)).length;
      await openPasswordSheet(env);
      await nextPrompt(env.polkit, before, { label: "a prompt for the password after five minutes" });
      await env.settings.waitFor("!document.body.innerText.includes('…')", { timeout: 10000, label: "the password to load" }).catch(() => {});
      const afterOpen = (await prompts(env.polkit)).length;
      await editPassword(env, "edited-allow");
      await delay(2000);
      const promptsForSave = (await prompts(env.polkit)).length - afterOpen;
      const now = await revealed(env);
      if (promptsForSave !== 0) throw new Error(`Save asked polkit ${promptsForSave} more times inside the grant`);
      if (now !== "edited-allow") throw new Error(`the password is ${JSON.stringify(now)} after Save`);
      return { sinceUnlockMs: Date.now() - unlockedAt, promptsForSave, password: "edited" };
    }, { timeout: GRANT_MS + 120000 });
    await t.stop(env.app);
    for (const mode of REFUSALS) {
      await t.check(`after the grant runs out, Edit › Save with a ${mode} answer saves nothing`, async () => {
        const outcome = await edits[mode];
        if (outcome.error) throw outcome.error;
        return outcome.value;
      }, { timeout: GRANT_MS + 300000 });
    }
  },
};

const MACOS_WORDS = /\bMac\b|macOS|Keychain|Touch ID|Applications folder|Finder|iCloud/;
const LAYOUT = `(() => {
  const texts = [...document.querySelectorAll('div, span')].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().left > 220);
  const boxes = texts.map((n) => { const r = n.getBoundingClientRect(); return { text: n.innerText.trim().slice(0, 60), left: r.left, top: r.top, right: r.right, bottom: r.bottom, clipped: n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible' }; });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.text === b.text) continue;
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (x > 2 && y > 2) overlaps.push([a.text, b.text]);
  }
  return { width: innerWidth, overflow: boxes.filter((b) => b.right > innerWidth + 1).map((b) => b.text), clipped: boxes.filter((b) => b.clipped).map((b) => b.text), overlaps: overlaps.slice(0, 5), tops: Object.fromEntries(boxes.map((b) => [b.text, Math.round(b.top)])) };
})()`;

async function paneLayout(t, desktop, window, settings, pane, marker) {
  await openPane(desktop, window, settings, pane, marker);
  await delay(800);
  await desktopShot(t, desktop, `wording-${pane.toLowerCase()}`);
  const layout = await settings.eval(LAYOUT);
  const lines = await paneLines(settings);
  return { layout, lines };
}

export const s104Desktop = {
  id: "S104D",
  issue: 104,
  desktop: true,
  title: "Passwords and Autofill in a desktop session with gnome-keyring: the keyring notice and Storage row sit above the pane content, name the keyring, read without macOS words, and nothing overlaps or overflows",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["keyring", "dbusmock"] });
    if (missing) {
      t.manual("Wording reads naturally on the desktop", ["Open Settings › Passwords and Autofill: the notice and Storage rows sit above the panes, name the keyring and Unlock asks for the system password."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    await startKeyring(desktop);
    const polkit = await startPolkit(desktop, { mode: "allow" });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "wording", session: sessionSeed(), extraArgs: ["--password-store=gnome-libsecret"] });
    const saved = await shell.invoke("ArdiaPasswords.save", { args: ["", ORIGIN, USER, SECRET] });
    if (!saved.ok) throw new Error(`seeding a password failed: ${JSON.stringify(saved)}`);
    const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Passwords" });
    for (const [pane, marker, unit] of [["Passwords", "Import CSV…", "Passwords are locked"], ["Autofill", "Credit Cards", "Addresses"]]) {
      await t.check(`Settings › ${pane}: the Storage row names the Secret Service keyring above the pane's own content, without macOS words, overlaps or overflow`, async () => {
        const { layout, lines } = await paneLayout(t, desktop, window, settings, pane, marker);
        const text = lines.join("\n");
        const storageAt = lines.indexOf("Storage on this computer");
        const storage = lines[storageAt + 1] ?? "";
        if (storageAt < 0 || !/Secret Service|keyring/i.test(storage)) throw new Error(`storage row ${JSON.stringify(storage)}`);
        if (MACOS_WORDS.test(text)) throw new Error(`macOS wording: ${text.match(MACOS_WORDS)[0]}`);
        if (layout.tops["Storage on this computer"] === undefined || layout.tops[unit] === undefined || layout.tops["Storage on this computer"] >= layout.tops[unit]) throw new Error(`Storage row at ${layout.tops["Storage on this computer"]}, ${unit} at ${layout.tops[unit]}`);
        if (layout.overflow.length || layout.clipped.length || layout.overlaps.length) throw new Error(JSON.stringify({ overflow: layout.overflow, clipped: layout.clipped, overlaps: layout.overlaps }));
        return { storage, storageTop: layout.tops["Storage on this computer"], [`${unit} top`]: layout.tops[unit], width: layout.width };
      });
    }
    await t.check("Unlock says it asks for the system password and asks polkit", async () => {
      await openPane(desktop, window, settings, "Passwords", "Import CSV…");
      const lines = await paneLines(settings);
      const hint = lines[lines.indexOf("Passwords are locked") + 1] ?? "";
      if (!/system password/.test(hint)) throw new Error(`hint ${JSON.stringify(hint)}`);
      const before = (await prompts(polkit)).length;
      await clickTextIn(desktop, window, settings, "Unlock");
      await nextPrompt(polkit, before);
      return { hint };
    });
    await t.stop(app);
  },
};
