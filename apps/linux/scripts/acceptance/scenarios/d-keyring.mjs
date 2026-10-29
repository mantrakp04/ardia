import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clickTextIn, desktopShot, desktopUnavailable, openDesktop, openSettingsWindow, pointAt, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { answerPrompter, enablePrompter, prompterMissing, prompterWindow, startKeyring } from "../lib/desktopKeyring.mjs";
import { startPolkit, startPortal } from "../lib/desktopServices.mjs";
import { buttonNear, fieldRect, nextPrompt, paneLines, paneText, prompts, typeInto } from "../lib/desktopSettings.mjs";
import { LIVE_FIXTURE } from "../lib/liveServices.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";
import { plaintextTokens, TOKEN_DIRECTORY } from "./f11-live-services.mjs";

const LIVE_SCHEMA = "dev.ardia.linux.LiveToken";
const hex = (text) => Buffer.from(text, "utf8").toString("hex");
const exists = (path) => access(path).then(() => true, () => false);

const folderStatus = (shell) => shell.eval("(() => { const L = ardiaLinux.live; const S = L.store.getState(); return Object.keys(S.items ?? {}).map((id) => ({ id, status: L.statusText(id), items: (S.items[id] ?? []).length })); })()", { timeout: 5000 });
const githubRequests = (fixtures) => fixtures.live.requests().filter((r) => r.host === "api.github.com").length;

async function browserWindow(desktop) {
  return until(async () => (await desktop.windows()).find((w) => / - Ardia$/.test(w.title) || w.title === "Ardia") ?? false, { timeout: 10000, label: "the browser window" });
}

async function sidebarMenu(desktop, shell, at, item, { submenu } = {}) {
  const window = await browserWindow(desktop);
  await desktop.raise(window);
  await delay(300);
  await desktop.click(window.rect.x + at.x, window.rect.y + at.y, "right");
  const entry = await until(() => shell.rectByText(item), { timeout: 5000, label: `${item} in the sidebar menu` });
  if (submenu) {
    await desktop.pointerMove(window.rect.x + entry.x, window.rect.y + entry.y);
    const sub = await until(() => shell.rectByText(submenu), { timeout: 5000, label: `${submenu} in the ${item} submenu` });
    await desktop.pointerMove(window.rect.x + sub.x - 30, window.rect.y + sub.y);
    await delay(200);
    await desktop.click(window.rect.x + sub.x, window.rect.y + sub.y);
  } else await desktop.click(window.rect.x + entry.x, window.rect.y + entry.y);
  await delay(500);
}

async function refreshFolder(desktop, shell) {
  const title = await until(() => shell.rectByText("Pull Requests"), { timeout: 8000, label: "the Pull Requests folder in the sidebar" });
  await sidebarMenu(desktop, shell, title, "Refresh");
}

async function waitStatus(shell, test, label) {
  return until(async () => {
    const [folder] = await folderStatus(shell);
    return folder && test(folder.status) ? folder : false;
  }, { timeout: 20000, interval: 300, label });
}

export const f11Keyring = {
  id: "F11K",
  issue: 21,
  desktop: true,
  title: "Live folder tokens in a private gnome-keyring: Connect from Settings stores an Ardia Live Folder Token item, nothing under the profile; a keyring locked at launch is named and unlocking it recovers",
  deadline: 360000,
  async run(t) {
    const missing = (await prompterMissing()) ?? await desktopUnavailable({ needs: ["keyring"] });
    if (missing) {
      t.manual("Tokens live in the desktop keyring", ["Connect GitHub in Settings › Live Folders with GNOME Keyring running: the keyring has an Ardia Live Folder Token item; lock it and refresh: the folder asks to unlock; unlock and refresh recovers."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    await desktop.command("layout tabbed");
    const keyring = await startKeyring(desktop);
    let { app, shell, scratch } = await startDesktopBrowser(t, desktop, { name: "live-keyring", session: sessionSeed() });
    await t.check("Settings › Live Folders › GitHub › Connect… with a token stores it as an Ardia Live Folder Token in the keyring and nothing under the profile", async () => {
      const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Live Folders" });
      let field = null;
      for (let attempt = 0; attempt < 3 && !field; attempt++) {
        await pointAt(desktop, window, await until(() => buttonNear(settings, "GitHub", "Connect…"), { timeout: 8000, label: "GitHub's Connect… button" }));
        field = await until(() => fieldRect(settings, { type: "password" }), { timeout: 5000, label: "the token field" }).catch(() => null);
      }
      if (!field) throw new Error(`Connect… never opened the GitHub sheet; pane ${JSON.stringify((await paneLines(settings)).slice(14, 30))}`);
      await typeInto(desktop, window, settings, field, LIVE_FIXTURE.github.token);
      await clickTextIn(desktop, window, settings, "Connect");
      await settings.waitFor(`document.body.innerText.includes(${JSON.stringify(`(${LIVE_FIXTURE.github.login})`)})`, { timeout: 20000, label: "Connected as … in Settings" });
      await desktopShot(t, desktop, "live-connected");
      const items = await keyring.search({ "xdg:schema": LIVE_SCHEMA }, { secrets: true });
      if (items.length !== 1 || items[0].label !== "Ardia Live Folder Token" || items[0].attributes.account !== "github") throw new Error(`keyring items ${JSON.stringify(items.map(({ secret, ...rest }) => rest))}`);
      if (!Buffer.from(items[0].secret ?? "", "hex").toString("utf8").includes(`token=${hex(LIVE_FIXTURE.github.token)}`)) throw new Error("the keyring item doesn't hold the token");
      if (await exists(join(scratch, TOKEN_DIRECTORY))) throw new Error(`${TOKEN_DIRECTORY} exists under the profile`);
      const leaks = await plaintextTokens(scratch, [LIVE_FIXTURE.github.token]);
      if (leaks.length) throw new Error(`the token is in the profile: ${leaks.join(", ")}`);
      await desktop.key("ctrl+w");
      return { label: items[0].label, account: items[0].attributes.account, schema: items[0].attributes["xdg:schema"] };
    });
    await t.check("New Live Folder › Pull Requests from the sidebar lists the account's pull requests", async () => {
      await sidebarMenu(desktop, shell, { x: 90, y: 600 }, "New Live Folder", { submenu: "Pull Requests" });
      const folder = await waitStatus(shell, (s) => s.startsWith("Updated"), "the new folder to update");
      await shell.waitFor("document.body.innerText.includes('Fixture pull request one')", { timeout: 10000, label: "a fixture pull request in the sidebar" });
      return folder;
    });
    await t.check("locking the keyring while Ardia runs keeps the token Ardia already read: Refresh updates the folder and its request carries the token", async () => {
      await keyring.lock();
      const before = t.fixtures.live.requests().length;
      const lastFetch = await shell.eval("(() => { const S = ardiaLinux.live.store.getState(); return Object.values(S.status ?? {})[0]?.lastFetch ?? 0; })()");
      await refreshFolder(desktop, shell);
      const request = await until(() => t.fixtures.live.requests().slice(before).find((r) => r.host === "api.github.com") ?? false, { timeout: 15000, label: "a GitHub request after Refresh" });
      if (!(request.headers.authorization ?? "").includes(LIVE_FIXTURE.github.token)) throw new Error(`the request's authorization is ${JSON.stringify((request.headers.authorization ?? "").slice(0, 12))}…, not the stored token`);
      const folder = await waitStatus(shell, (s) => s.startsWith("Updated"), "the folder to say Updated after Refresh");
      const fetched = await shell.eval("(() => { const S = ardiaLinux.live.store.getState(); return Object.values(S.status ?? {})[0]?.lastFetch ?? 0; })()");
      if (!(fetched > lastFetch)) throw new Error(`the folder's last fetch didn't move (${lastFetch} → ${fetched})`);
      return { status: folder.status, authorization: "the stored token" };
    });
    await t.stop(app);
    await enablePrompter(desktop);
    await t.check("with the keyring locked at launch, Ardia's token lookup raises gnome-keyring's unlock prompt, and unlocking it updates the folder", async () => {
      ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "locked-launch-unlock" }));
      try {
        const prompt = await prompterWindow(desktop, { timeout: 30000 });
        await desktopShot(t, desktop, "live-unlock-prompt");
        await answerPrompter(desktop, prompt, { allow: true });
        const folder = await waitStatus(shell, (s) => s.startsWith("Updated"), "the folder to update after unlocking in the prompt");
        if (await keyring.locked()) throw new Error("the keyring is still locked after the prompt");
        return { prompt: prompt.title, folder: folder.status };
      } finally {
        await t.stop(app);
      }
    }, { timeout: 120000 });
    await keyring.lock();
    ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "locked-launch-dismiss" }));
    await t.check("with the keyring locked at launch and its unlock prompt dismissed, the folder says to unlock the keyring", async () => {
      const prompt = await prompterWindow(desktop, { timeout: 30000 });
      await answerPrompter(desktop, prompt, { allow: false });
      const folder = await waitStatus(shell, (s) => !/Updating|Loading/.test(s), "the folder's status after the dismissed prompt");
      await desktopShot(t, desktop, "live-prompt-dismissed");
      if (!/keyring/i.test(folder.status)) throw new Error(`the folder says ${JSON.stringify(folder.status)}, not to unlock the keyring`);
      return folder;
    }, { timeout: 120000 });
    await t.check("after a dismissed prompt, Refresh asks again and unlocking then updates the folder", async () => {
      const before = githubRequests(t.fixtures);
      await refreshFolder(desktop, shell);
      const prompt = await prompterWindow(desktop, { timeout: 10000 }).catch(() => null);
      if (!prompt) throw new Error(`Refresh raised no unlock prompt; the folder says ${JSON.stringify((await folderStatus(shell))[0]?.status)}, GitHub requests since ${githubRequests(t.fixtures) - before}`);
      await answerPrompter(desktop, prompt, { allow: true });
      return waitStatus(shell, (s) => s.startsWith("Updated"), "the folder to update after unlocking");
    }, { timeout: 120000 });
    await t.stop(app);
  },
};

const SYNC_SCHEMA = "dev.ardia.linux.SyncKey";
const DISCLOSURE_MS = 60_000;
const syncState = (shell) => shell.eval("(() => { const s = ardiaLinux.sync.state(); return { status: s.status, enabled: s.enabled, folder: s.folder, error: s.error, device: (s.devices ?? []).find((d) => d.current)?.id ?? null }; })()", { timeout: 5000 });

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

async function syncPane(desktop, app, shell) {
  const { settings, window } = await openSettingsWindow(desktop, app, shell);
  const shown = () => settings.eval("document.body.innerText.includes('It all goes through a folder you choose')", { timeout: 3000 }).catch(() => false);
  for (let attempt = 0; attempt < 4 && !(await shown()); attempt++) {
    await clickTextIn(desktop, window, settings, "Sync");
    await until(shown, { timeout: 4000, label: "the Sync pane" }).catch(() => false);
  }
  if (!(await shown())) throw new Error(`the Sync pane never showed; pane ${JSON.stringify((await paneLines(settings).catch(() => [])).slice(12, 30))}`);
  return { settings, window };
}

async function sheetButtons(settings, title) {
  const lines = await paneLines(settings);
  const at = lines.lastIndexOf(title);
  return at >= 0 ? lines.slice(at).filter((l) => !["×", "−", "+"].includes(l)) : null;
}

async function clipboard(desktop) {
  return desktop.run("wl-paste", ["-n"], { timeout: 5000 }).catch(() => "");
}

async function saveKit(env, folder, mode) {
  const { desktop, window, settings, polkit, portal } = env;
  const target = join(folder, `kit-${mode}.txt`);
  await polkit.call("SetMode", [mode]);
  await portal.pick("SaveFile", [target]);
  const saves = (await portal.calls()).filter((c) => c.method === "SaveFile").length;
  const before = (await prompts(polkit)).length;
  await clickTextIn(desktop, window, settings, "Save as Text…");
  const save = await until(async () => (await portal.calls()).filter((c) => c.method === "SaveFile")[saves] ?? false, { timeout: 15000, label: "the portal's SaveFile request" });
  const call = await nextPrompt(polkit, before);
  await delay(1500);
  return { target, save, call, written: await exists(target) };
}

async function disclose(env, button, mode) {
  const { desktop, window, settings, polkit } = env;
  await polkit.call("SetMode", [mode]);
  const before = (await prompts(polkit)).length;
  await clickTextIn(desktop, window, settings, button);
  await delay(1800);
  const text = await paneText(settings);
  return {
    prompts: (await prompts(polkit)).length - before,
    wordsShown: env.words ? env.words.slice(0, 3).every((w) => new RegExp(`\\b${w}\\b`).test(text)) : null,
    code: await settings.eval("[...document.querySelectorAll('img')].some((i) => i.getBoundingClientRect().width >= 100 && i.src.startsWith('data:image/png'))"),
    clipboard: await clipboard(desktop),
  };
}

async function refusedTurnOn(t, state) {
  const desktop = await openDesktop(t, { name: `sync-${state}` });
  await desktop.command("layout tabbed");
  const keyring = state === "absent" ? null : await startKeyring(desktop, { state });
  if (keyring) await enablePrompter(desktop);
  try {
    const { app, shell, scratch } = await startDesktopBrowser(t, desktop, { name: `sync-${state}`, session: sessionSeed() });
    const { settings, window } = await syncPane(desktop, app, shell);
    await clickTextIn(desktop, window, settings, "Turn On Sync");
    const prompt = keyring ? await prompterWindow(desktop, { timeout: 15000 }).catch(() => null) : null;
    if (prompt) await answerPrompter(desktop, prompt, { allow: false });
    const message = await until(async () => (await paneLines(settings)).find((l) => /Couldn’t save the sync key/.test(l)) ?? false, { timeout: 15000, label: "the keyring message after Turn On Sync" });
    await desktopShot(t, desktop, `sync-turn-on-${state}`);
    const sync = await syncState(shell);
    const folderFiles = sync.folder ? await filesUnder(sync.folder) : [];
    const keyDir = await exists(join(scratch, "Ardia Sync Keys"));
    const items = keyring ? await keyring.search({ "xdg:schema": SYNC_SCHEMA }) : [];
    let afterUnlock = null;
    if (keyring) {
      await clickTextIn(desktop, window, settings, "Turn On Sync");
      const again = await prompterWindow(desktop, { timeout: 15000 }).catch(() => null);
      if (again) await answerPrompter(desktop, again, { allow: true });
      const on = await until(async () => { const s = await syncState(shell); return s.enabled ? s : false; }, { timeout: 20000, label: "sync to turn on after unlocking in the prompt" }).catch(() => null);
      afterUnlock = { prompted: !!again, enabled: !!on, items: (await keyring.search({ "xdg:schema": SYNC_SCHEMA })).length };
    }
    await t.stop(app);
    return { prompted: !!prompt, message, enabled: sync.enabled, folderFiles: folderFiles.length, keyDir, items: items.length, afterUnlock };
  } finally {
    await keyring?.stop();
    await desktop.stop();
  }
}

export const f13Keyring = {
  id: "F13K",
  issue: 23,
  desktop: true,
  title: "The sync key in a private gnome-keyring, refusals when it is locked or absent, and the recovery phrase behind the mocked polkit authority (Recovery Kit, Show Words, Show Code, Copy Words)",
  deadline: 720000,
  async run(t) {
    const missing = (await prompterMissing()) ?? await desktopUnavailable({ needs: ["keyring", "dbusmock", "portal"] });
    if (missing) {
      t.manual("The sync key lives in the desktop keyring", ["Turn On Sync with GNOME Keyring running: an Ardia Sync Key item appears; restart resumes without the phrase."], missing);
      t.manual("No or locked keyring fails safely", ["With no keyring or a locked one, Turn On Sync explains and writes nothing; a keyring locked at launch shows not syncing and the phrase resumes."], missing);
      t.manual("The recovery phrase needs system authentication", ["Show Words, Show Code, Copy Words and Save as Text prompt once and work for 60 s; refusals show, copy and write nothing; the kit is 0600."], missing);
      return;
    }
    const refusals = { absent: refusedTurnOn(t, "absent").then((value) => ({ value }), (error) => ({ error })), locked: refusedTurnOn(t, "locked").then((value) => ({ value }), (error) => ({ error })) };
    const desktop = await openDesktop(t);
    await desktop.command("layout tabbed");
    const keyring = await startKeyring(desktop);
    const polkit = await startPolkit(desktop, { mode: "allow" });
    const portal = await startPortal(desktop);
    let { app, shell, scratch } = await startDesktopBrowser(t, desktop, { name: "sync", session: sessionSeed() });
    const env = { desktop, polkit, portal, ...(await syncPane(desktop, app, shell)) };
    const kits = await t.scratch("kits");
    let device;
    await t.check("Turn On Sync stores an Ardia Sync Key item whose account is this device's id, and nothing under the profile folder", async () => {
      await clickTextIn(desktop, env.window, env.settings, "Turn On Sync");
      await env.settings.waitFor("document.body.innerText.includes('Save as Text…')", { timeout: 20000, label: "the Recovery Kit sheet after Turn On Sync" });
      const sync = await until(async () => { const s = await syncState(shell); return s.enabled && s.device ? s : false; }, { timeout: 15000, label: "sync to be on" });
      device = sync.device;
      const items = await keyring.search({ "xdg:schema": SYNC_SCHEMA });
      if (items.length !== 1 || items[0].label !== "Ardia Sync Key" || items[0].attributes.account !== device) throw new Error(`keyring items ${JSON.stringify(items)} for device ${device}`);
      if (await exists(join(scratch, "Ardia Sync Keys"))) throw new Error("an Ardia Sync Keys folder exists under the profile");
      return { label: items[0].label, account: items[0].attributes.account, folder: sync.folder };
    });
    await t.check("the Recovery Kit sheet offers Close and Save as Text… only", async () => {
      const lines = await sheetButtons(env.settings, "Save Your Recovery Kit");
      const buttons = lines.filter((l) => ["Close", "Save as Text…", "Save…", "Other Options", "Print…", "Save as PDF…", "Copy", "Share…", "Preview"].includes(l));
      await desktopShot(t, desktop, "recovery-kit-sheet");
      if (buttons.join("|") !== "Close|Save as Text…") throw new Error(`buttons ${JSON.stringify(buttons)}`);
      return { buttons };
    });
    for (const mode of ["deny", "dismiss"]) {
      await t.check(`Save as Text… shows the save dialog, then prompts; a ${mode} answer writes nothing`, async () => {
        const result = await saveKit(env, kits, mode);
        if (result.written) throw new Error(`${result.target} was written`);
        if (result.call.at < result.save.at) throw new Error("polkit was asked before the save dialog");
        return { title: result.save.title, currentName: result.save.options.current_name };
      });
    }
    let grantedAt;
    await t.check("Save as Text… with an allowed prompt writes a 0600 file with the 24 words", async () => {
      const result = await saveKit(env, kits, "allow");
      grantedAt = Date.now();
      if (!result.written) throw new Error("no file");
      const mode = (await stat(result.target)).mode & 0o777;
      const body = await readFile(result.target, "utf8");
      env.words = [...body.matchAll(/^\s*\d+\. (\S+)$/gm)].map((m) => m[1]);
      if (mode !== 0o600) throw new Error(`mode ${mode.toString(8)}`);
      if (env.words.length !== 24) throw new Error(`${env.words.length} words in the kit`);
      const leaks = (await plaintextTokens(scratch, [env.words.join(" ")])).concat(await plaintextTokens(scratch, [env.words.slice(0, 4).join("\n")]));
      if (leaks.length) throw new Error(`the phrase is in the profile: ${leaks.join(", ")}`);
      return { mode: "600", words: env.words.length };
    });
    await clickTextIn(desktop, env.window, env.settings, "Close");
    await desktop.run("wl-copy", ["ardia-clipboard-sentinel"], { timeout: 5000 }).catch(() => {});
    await until(() => Date.now() - grantedAt > DISCLOSURE_MS + 3000, { timeout: DISCLOSURE_MS + 10000, interval: 1000, label: "the kit's 60 s grant to run out" });
    await clickTextIn(desktop, env.window, env.settings, "Connect Another Device…");
    await env.settings.waitFor("document.body.innerText.includes('Show Words')", { timeout: 10000, label: "the Connect Another Device sheet" });
    for (const mode of ["deny", "dismiss"]) {
      await t.check(`with a ${mode} answer, Show Words, Show Code and Copy Words each prompt and show, draw and copy nothing`, async () => {
        const words = await disclose(env, "Show Words", mode);
        const code = await disclose(env, "Show Code", mode);
        const copy = await disclose(env, "Copy Words", mode);
        for (const [name, r] of Object.entries({ words, code, copy })) if (r.prompts !== 1 || r.wordsShown || r.code || r.clipboard.includes(env.words[0])) throw new Error(`${name}: ${JSON.stringify({ ...r, clipboard: r.clipboard.slice(0, 20) })}`);
        return { prompts: 3 };
      });
    }
    await t.check("an allowed Show Words prompts once; Show Code and Copy Words then work without prompting inside 60 s", async () => {
      const words = await disclose(env, "Show Words", "allow");
      const allowedAt = Date.now();
      await desktopShot(t, desktop, "recovery-words");
      const code = await disclose(env, "Show Code", "deny");
      const copy = await disclose(env, "Copy Words", "deny");
      if (words.prompts !== 1 || !words.wordsShown) throw new Error(`Show Words ${JSON.stringify(words)}`);
      if (code.prompts !== 0 || !code.code) throw new Error(`Show Code ${JSON.stringify(code)}`);
      if (copy.prompts !== 0 || copy.clipboard !== env.words.join(" ")) throw new Error(`Copy Words ${JSON.stringify({ ...copy, clipboard: copy.clipboard.slice(0, 20) })}`);
      env.allowedAt = allowedAt;
      return { showWords: words.prompts, showCode: code.prompts, copyWords: copy.prompts };
    });
    await t.check("60 s later Copy Words prompts again", async () => {
      await until(() => Date.now() - env.allowedAt > DISCLOSURE_MS + 3000, { timeout: DISCLOSURE_MS + 10000, interval: 1000, label: "the 60 s grant to run out" });
      const copy = await disclose(env, "Copy Words", "deny");
      if (copy.prompts !== 1) throw new Error(`Copy Words asked ${copy.prompts} times`);
      return { prompts: copy.prompts };
    }, { timeout: 90000 });
    await clickTextIn(desktop, env.window, env.settings, "Done").catch(() => {});
    await t.stop(app);
    await t.check("a restart resumes sync from the keyring without asking for the phrase", async () => {
      ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "restart" }));
      const sync = await until(async () => { const s = await syncState(shell); return s.enabled && s.status !== "starting" ? s : false; }, { timeout: 20000, label: "sync after the restart" });
      if (sync.error || /not|locked|error/i.test(sync.status)) throw new Error(JSON.stringify(sync));
      await t.stop(app);
      return { status: sync.status };
    });
    await enablePrompter(desktop);
    await keyring.lock();
    await t.check("with the keyring locked at launch, Ardia raises gnome-keyring's unlock prompt and unlocking it resumes sync", async () => {
      ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "locked-unlock" }));
      try {
        const prompt = await prompterWindow(desktop, { timeout: 30000 });
        await desktopShot(t, desktop, "sync-unlock-prompt");
        await answerPrompter(desktop, prompt, { allow: true });
        const sync = await until(async () => { const s = await syncState(shell); return s.enabled && s.status === "updated" && !s.error ? s : false; }, { timeout: 30000, label: "sync to resume after unlocking" });
        return { prompt: prompt.title, status: sync.status };
      } finally {
        await t.stop(app);
      }
    }, { timeout: 120000 });
    await keyring.lock();
    ({ app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: "locked-dismiss" }));
    await prompterWindow(desktop, { timeout: 30000 }).then((prompt) => answerPrompter(desktop, prompt, { allow: false })).catch(() => {});
    const lockedPane = await syncPane(desktop, app, shell);
    await t.check("with the keyring locked at launch and its unlock prompt dismissed, Sync says not syncing and names the locked keyring", async () => {
      const lines = await until(async () => {
        const l = await paneLines(lockedPane.settings);
        return l.some((x) => /not syncing/i.test(x)) ? l : false;
      }, { timeout: 20000, label: "not syncing in the Sync pane" });
      await desktopShot(t, desktop, "sync-locked-launch");
      const notSyncing = lines.find((l) => /not syncing/i.test(l));
      const message = lines[lines.indexOf("Advanced…") + 1] ?? null;
      if (!lines.includes("Enter Recovery Phrase…")) throw new Error(`no Enter Recovery Phrase…: ${JSON.stringify(lines.slice(14, 24))}`);
      if (!lines.some((x) => /Your keyring is locked/.test(x))) throw new Error(`the pane says ${JSON.stringify(notSyncing)} and ${JSON.stringify(message)}, without the keyring message ("Your keyring is locked. Unlock it, or enter your recovery phrase to keep syncing.")`);
      return { notSyncing, message };
    });
    await t.check("with the keyring locked at launch and its prompt dismissed, entering the recovery phrase resumes sync", async () => {
      const pane = lockedPane;
      await clickTextIn(desktop, pane.window, pane.settings, "Enter Recovery Phrase…");
      const field = await until(() => pane.settings.eval("(() => { const n = [...document.querySelectorAll('textarea, input')].filter((n) => n.getBoundingClientRect().width > 100).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()"), { timeout: 8000, label: "the phrase field" });
      await typeInto(desktop, pane.window, pane.settings, field, env.words.join(" "));
      const sheet = (await paneLines(pane.settings)).slice(-12);
      await clickTextIn(desktop, pane.window, pane.settings, "Connect");
      const prompt = await prompterWindow(desktop, { timeout: 6000 }).catch(() => null);
      if (prompt) await answerPrompter(desktop, prompt, { allow: false });
      await delay(2000);
      await desktopShot(t, desktop, "sync-phrase-connect");
      const sync = await until(async () => { const s = await syncState(shell); return s.enabled && !s.error && s.status === "updated" ? s : false; }, { timeout: 30000, label: "sync to resume after the phrase" }).catch(async (error) => { throw new Error(`${error.message}; Connect raised ${prompt ? "an unlock prompt (dismissed again)" : "no unlock prompt"}; sheet before Connect ${JSON.stringify(sheet)}; after ${JSON.stringify((await paneLines(pane.settings)).slice(-12))}; state ${JSON.stringify(await syncState(shell))}`); });
      return { status: sync.status, promptedAgain: !!prompt };
    }, { timeout: 120000 });
    await t.stop(app);
    for (const state of ["absent", "locked"]) {
      await t.check(state === "absent" ? "with no keyring running, Turn On Sync explains it and writes nothing" : "with the keyring locked, Turn On Sync raises the unlock prompt; dismissed, it explains and writes nothing; unlocked, sync turns on and stores its key", async () => {
        const outcome = await refusals[state];
        if (outcome.error) throw outcome.error;
        const r = outcome.value;
        const want = state === "absent" ? /no keyring is running/ : /your keyring is locked/;
        if (!want.test(r.message) || r.enabled || r.folderFiles || r.keyDir || r.items) throw new Error(JSON.stringify(r));
        if (state === "locked" && (!r.prompted || !r.afterUnlock?.prompted || !r.afterUnlock.enabled || r.afterUnlock.items !== 1)) throw new Error(`the unlock prompt path: ${JSON.stringify(r)}`);
        return r;
      }, { timeout: 200000 });
    }
  },
};
