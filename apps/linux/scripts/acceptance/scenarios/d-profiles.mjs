import { setTimeout as delay } from "node:timers/promises";
import { startPolkit, startPortal } from "../lib/desktopServices.mjs";
import { clickTextIn, commandBarText, currentRect, desktopShot, desktopUnavailable, openDesktop, settledRect, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { clickDialogButton, clickNeutral, labelRect, openedWindow, removeExtensionInSettings, rowToggle, shellLines } from "../lib/desktopUi.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { evaluate } from "../lib/cdp.mjs";
import { openPrivateByKeys } from "./d-private.mjs";
import { blockerAvailable, blockerReady, call, expectBlocked } from "./f06-site-controls.mjs";
import { FIXTURE_NAME, listed, prepareExtension } from "./f09-extensions.mjs";

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

async function openIsolated(app, shell, desktop, profileId, url) {
  const known = await desktop.windows();
  const shells = await liveShells(app);
  await shell.state(`return s.createWindow({ profileId: ${js(profileId)}, url: ${js(url)} });`);
  return openedWindow(desktop, app, known, shells, { label: "the isolated profile's window" });
}

async function pickProfile(desktop, settingsWindow, settings, current, wanted, t = null) {
  const findChip = () => settings.eval(`(() => { const n = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === ${js(current)} && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().left > 220).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const findItem = () => settings.eval(`(() => { const n = [...document.querySelectorAll('.ardia-menu .ardia-menu-item, [role=menuitem], [role=option]')].find((n) => (n.innerText ?? '').trim().split('\\n').pop() === ${js(wanted)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  let item = null;
  for (let attempt = 0; attempt < 3 && !item; attempt++) {
    const chip = await settledRect(findChip, { timeout: 20000, label: `the pane's ${current} profile picker at a settled position` });
    const frame = await currentRect(desktop, settingsWindow);
    await desktop.click(frame.x + chip.x, frame.y + chip.y);
    item = await until(findItem, { timeout: 10000, label: `${wanted} in the profile menu` }).catch(() => null);
    if (!item) await desktop.key("escape");
  }
  if (!item) {
    if (t) await desktopShot(t, desktop, "profile-menu-missing");
    const menu = await settings.eval("[...document.querySelectorAll('.ardia-menu .ardia-menu-item, [role=menuitem], [role=option]')].map((n) => (n.innerText ?? '').trim())").catch(() => null);
    throw new Error(`the profile menu never offered ${wanted} after three clicks on ${current}; menu ${JSON.stringify(menu)}`);
  }
  const frame = await currentRect(desktop, settingsWindow);
  await desktop.click(frame.x + item.x, frame.y + item.y);
  await until(async () => (await shellLines(settings)).includes(wanted), { timeout: 15000, label: `the pane to show ${wanted}` });
}

const SETTINGS_START = 60000;

async function focusSourceWindow(desktop, window, shell) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if ((await desktop.focused())?.id !== window.id) await desktop.raise(window);
      await waitFocused(desktop, (w) => w.id === window.id, { timeout: 15000, label: `${window.title} focused` });
      return await clickNeutral(desktop, window, shell);
    } catch (error) {
      last = error;
      await delay(1000);
    }
  }
  throw last;
}

async function settingsWindowOf(desktop) {
  return (await desktop.windows()).find((w) => w.title === "Settings" || /^Settings\b/.test(w.title)) ?? null;
}

async function closeSettings(desktop, app) {
  const gone = async () => !(await settingsWindowOf(desktop)) && !(await app.shells()).some((s) => s.windowId === "settings");
  if (await gone()) return;
  const window = await settingsWindowOf(desktop);
  if (window) {
    const settings = (await app.shells()).some((s) => s.windowId === "settings") ? await app.shell("settings", { timeout: 5000 }).catch(() => null) : null;
    const close = settings ? await labelRect(settings, "Close window").catch(() => null) : null;
    if (close) {
      await desktop.raise(window).catch(() => {});
      await waitFocused(desktop, (w) => w.id === window.id, { timeout: 10000, label: "Settings focused" }).catch(() => {});
      const frame = await currentRect(desktop, window);
      await desktop.click(frame.x + close.x, frame.y + close.y);
      if (await until(gone, { timeout: 10000, label: "Settings to close from its close button" }).then(() => true, () => false)) return;
    }
    const still = await settingsWindowOf(desktop);
    if (still) await desktop.command(`[con_id=${still.id}] kill`);
  }
  await until(gone, { timeout: 30000, label: "Settings to close" });
}

async function openSettingsWindowFrom(t, desktop, app, source) {
  let settingsShell = (await app.shells()).some((s) => s.windowId === "settings") ? await app.shell("settings", { timeout: 10000 }).catch(() => null) : null;
  if (!settingsShell) {
    await focusSourceWindow(desktop, source.window, source.shell);
    await desktop.key("ctrl+comma");
    settingsShell = await app.shell("settings", { timeout: SETTINGS_START / 2 }).catch(() => null);
    if (!settingsShell) {
      if ((await desktop.focused())?.id !== source.window.id) await focusSourceWindow(desktop, source.window, source.shell);
      await desktop.key("ctrl+comma");
      settingsShell = await app.shell("settings", { timeout: SETTINGS_START / 2 }).catch(async (error) => {
        await desktopShot(t, desktop, "settings-never-opened");
        throw error;
      });
    }
  }
  let window = await until(() => settingsWindowOf(desktop), { timeout: 20000, label: "the Settings window in the compositor" });
  await desktop.command(`[con_id=${window.id}] floating enable, resize set 1200 900, move position center, focus`);
  window = await until(async () => { const w = (await desktop.windows()).find((x) => x.id === window.id); return w?.floating && w.rect.width >= 1100 ? w : false; }, { timeout: 10000, label: "Settings floated at 1200×900" });
  await waitFocused(desktop, (w) => w.id === window.id, { timeout: 10000, label: "Settings focused" });
  return { settings: settingsShell, window };
}

async function openSettingsFrom(t, desktop, app, source, pane, ready) {
  const { settings, window } = await openSettingsWindowFrom(t, desktop, app, source);
  await until(async () => (await settings.text()).includes(pane), { timeout: 20000, label: `the ${pane} row in Settings` });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await settings.eval(ready).catch(() => false)) break;
    await clickTextIn(desktop, window, settings, pane, { timeout: 15000 });
    if (await settings.waitFor(ready, { timeout: 15000, label: `the ${pane} pane` }).then(() => true, () => false)) break;
  }
  await settings.waitFor(ready, { timeout: 15000, label: `the ${pane} pane` }).catch(async (error) => {
    await desktopShot(t, desktop, `settings-${pane.replace(/\W+/g, "-").toLowerCase()}-missing`);
    throw error;
  });
  return { settings, window };
}

async function pickedProfile(desktop, window, settings, workName, t = null) {
  const shown = (await shellLines(settings)).find((l) => l === workName || l === "Personal");
  if (shown !== workName) await pickProfile(desktop, window, settings, shown ?? "Personal", workName, t);
  return shown;
}

export const profilesDesktop = {
  id: "F02D",
  issue: 12,
  desktop: true,
  title: "From an isolated profile's window, Settings panes show that profile's sites and passwords, and extensions (the isolated copy installed through Choose Folder…) stay in the profile that installed them (sway)",
  deadline: 600000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim", "dbusmock", "portal"] });
    if (missing) {
      t.manual("Settings panes reach the isolated profile's services", ["Open Settings from the isolated profile's window; Passwords and Site Settings show only that profile's data."], missing);
      t.manual("Extensions stay per profile", ["Install an extension in one profile; the other profile's toolbar and Settings › Extensions don't list it."], missing);
      return;
    }
    const run = nonce("f02d");
    const desktop = await openDesktop(t);
    await startPolkit(desktop, { mode: "allow" });
    const portal = await startPortal(desktop);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "profiles", extensions: true, session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    await windowTitled(desktop, "Acceptance page 1");
    const workName = `Work ${run.slice(-4)}`;
    const work = await shell.state(`return s.createProfile({ name: ${js(workName)} });`);
    let isolated = null;
    const isolatedWindow = async () => {
      const live = isolated && (await app.shells()).some((s) => s.windowId === isolated.shell.windowId) && (await desktop.windows()).some((w) => w.id === isolated.window.id);
      if (!live) {
        await closeSettings(desktop, app);
        isolated = await openIsolated(app, shell, desktop, work, t.fixtures.url.page(3, run));
      }
      isolated.window = (await desktop.windows()).find((w) => w.id === isolated.window.id) ?? isolated.window;
      return isolated;
    };
    await call(shell, "sites.setSetting", { origin: "https://personal.ardia.test", type: "notifications", value: "allow", engine: "chromium" });
    await call(shell, "sites.setSetting", { origin: "https://work.ardia.test", type: "notifications", value: "allow", engine: "chromium" }, work);
    for (const [profile, user] of [["", `personal-${run}`], [work, `work-${run}`]]) {
      const saved = await shell.invoke("ArdiaPasswords.save", { args: [profile, `https://${profile ? "work" : "personal"}.ardia.test/login`, user, "f02d-secret"] });
      if (!saved.ok) throw new Error(`saving ${user} failed: ${saved.code} ${saved.message}`);
    }
    await t.check("Settings opened from the isolated window: Privacy › Site permissions for that profile lists only its site", async () => {
      const { settings, window } = await openSettingsFrom(t, desktop, app, await isolatedWindow(), "Privacy & Security", "document.body.innerText.includes('Site permissions')");
      const shown = await pickedProfile(desktop, window, settings, workName, t);
      const text = await settings.waitFor("(() => { const t = document.body.innerText; return t.includes('work.ardia.test') ? t : false; })()", { timeout: 15000, label: "the isolated profile's site" });
      await desktopShot(t, desktop, "isolated-site-permissions");
      if (text.includes("personal.ardia.test")) throw new Error("the default profile's site is listed for the isolated profile");
      return { defaulted: shown, picked: workName };
    }, { timeout: 180000 });
    await t.check("Passwords for that profile, unlocked, list only its login", async () => {
      const { settings, window } = await openSettingsFrom(t, desktop, app, await isolatedWindow(), "Passwords", "document.body.innerText.includes('Storage on this computer')");
      const shown = await pickedProfile(desktop, window, settings, workName, t);
      if (!(await settings.text()).includes(`work-${run}`)) await clickTextIn(desktop, window, settings, "Unlock", { timeout: 15000 });
      const text = await settings.waitFor(`(() => { const t = document.body.innerText; return t.includes(${js(`work-${run}`)}) ? t : false; })()`, { timeout: 20000, label: "the isolated profile's login" });
      await desktopShot(t, desktop, "isolated-passwords");
      if (text.includes(`personal-${run}`)) throw new Error("the default profile's login is listed for the isolated profile");
      return { defaulted: shown };
    }, { timeout: 180000 });
    const fixture = await prepareExtension(await t.scratch("profile-extension"));
    const personalCopy = async () => {
      const existing = listed(await shell.call("extensions.list", {}));
      const id = existing?.id ?? (await call(shell, "extensions.install", { path: fixture })).id;
      await call(shell, "extensions.configure", { id, options: { pinned: true } });
      await labelRect(shell, "Fixture Action");
      return id;
    };
    await t.check("an extension installed in the default profile is on the default window's toolbar, not the isolated window's, and Settings › Extensions from the isolated window doesn't list it", async () => {
      await closeSettings(desktop, app);
      await personalCopy();
      const source = await isolatedWindow();
      await until(async () => (await source.shell.labels()).length > 0, { timeout: 10000, label: "the isolated window's toolbar" });
      await delay(1500);
      if ((await source.shell.labels()).includes("Fixture Action")) throw new Error("the isolated window shows the default profile's extension");
      const { settings } = await openSettingsFrom(t, desktop, app, source, "Extensions", "document.body.innerText.includes('Add extensions')");
      const lines = await until(async () => { const l = await shellLines(settings); return l.includes(workName) || l.includes("No extensions yet") ? l : false; }, { timeout: 15000, label: "the pane to show the isolated profile or its empty state" }).catch(async (error) => {
        throw new Error(`${error.message}; pane ${JSON.stringify((await shellLines(settings)).slice(14, 30))}`);
      });
      await desktopShot(t, desktop, "isolated-extensions");
      if (lines.some((l) => l.includes(FIXTURE_NAME))) throw new Error(`Settings › Extensions from the isolated window lists ${FIXTURE_NAME}`);
      return { profileShown: lines.find((l) => l === workName || l === "Personal") ?? null };
    }, { timeout: 180000 });
    await t.check("installed in the isolated profile through its pane's Choose Folder…, it shows on its toolbar and in the open pane; removing it from the isolated profile's Settings › Extensions leaves the default profile's copy", async () => {
      await personalCopy();
      const source = await isolatedWindow();
      const { settings, window } = await openSettingsFrom(t, desktop, app, source, "Extensions", "document.body.innerText.includes('Add extensions')");
      const shown = await pickedProfile(desktop, window, settings, workName, t).catch(() => null);
      const copy = await prepareExtension(await t.scratch("isolated-extension"));
      if (!(await settings.text()).includes("Choose Folder…")) {
        const advanced = await until(() => rowToggle(settings, "Show advanced settings"), { timeout: 10000, label: "the Show advanced settings toggle" });
        const frame = await currentRect(desktop, window);
        await desktop.click(frame.x + advanced.x, frame.y + advanced.y);
        await settings.waitFor("document.body.innerText.includes('Choose Folder…')", { timeout: 15000, label: "the Choose Folder… row" });
      }
      const dialog = `Add “${FIXTURE_NAME}”?`;
      let attempts = 0;
      while (!(await settings.text()).includes(dialog) && attempts < 4) {
        attempts++;
        await portal.pick("OpenFile", [copy], { delay: 1.5 });
        await clickTextIn(desktop, window, settings, "Choose Folder…", { timeout: 15000 });
        await settings.waitFor(`document.body.innerText.includes(${js(dialog)})`, { timeout: 15000, label: "Ardia's Add dialog" }).catch(() => null);
      }
      if (!(await settings.text()).includes(dialog)) throw new Error(`Ardia's Add dialog never appeared in ${attempts} picks (#250)`);
      await clickDialogButton(desktop, window, settings, dialog, "Add Extension");
      let answeredBy = "click";
      if (!(await until(async () => !(await settings.text()).includes(dialog), { timeout: 5000, label: "the Add dialog to close" }).then(() => true, () => false))) {
        await desktopShot(t, desktop, "isolated-add-click-ignored");
        await desktop.key("return");
        answeredBy = (await until(async () => !(await settings.text()).includes(dialog), { timeout: 8000, label: "Enter" }).then(() => true, () => false)) ? "Enter after the click was ignored" : "nothing: neither the click nor Enter closed it";
      }
      const workId = await until(async () => (await shell.call("extensions.list", {}, work)).value?.extensions?.find((x) => x.name === FIXTURE_NAME)?.id ?? false, { timeout: 30000, label: "the extension installed in the isolated profile" }).catch(async (error) => {
        await desktopShot(t, desktop, "isolated-choose-folder");
        throw new Error(`${error.message}; the Add dialog was answered by ${answeredBy}; pane ${JSON.stringify((await shellLines(settings)).slice(14, 30))}`);
      });
      await call(shell, "extensions.configure", { id: workId, options: { pinned: true } }, work);
      await labelRect(source.shell, "Fixture Action");
      await settings.waitFor(`document.body.innerText.includes(${js(FIXTURE_NAME)}) && !document.body.innerText.includes(${js(dialog)})`, { timeout: 15000, label: "the isolated profile's copy in its open Settings › Extensions pane" }).catch(async (error) => {
        await desktopShot(t, desktop, "isolated-extensions-after-install");
        throw new Error(`${error.message}; pane ${JSON.stringify((await shellLines(settings)).slice(14, 30))} (#281)`);
      });
      await removeExtensionInSettings(desktop, window, settings, FIXTURE_NAME, async () => !(await shell.call("extensions.list", {}, work)).value.extensions.some((x) => x.id === workId));
      const personal = listed(await shell.call("extensions.list", {}));
      if (!personal?.enabled) throw new Error(`the default profile's copy is ${JSON.stringify(personal)}`);
      await until(async () => !(await source.shell.labels()).includes("Fixture Action"), { timeout: 10000, label: "the removed extension off the isolated toolbar" });
      await labelRect(shell, "Fixture Action");
      return { personal: personal.id, removed: workId, attempts, answeredBy, defaulted: shown };
    }, { timeout: 180000 });
    await closeSettings(desktop, app).catch(() => {});
    await t.stop(app);
  },
};

export const privateCredentialsDesktop = {
  id: "F07P",
  issue: 17,
  desktop: true,
  title: "A private window opened with Ctrl+Shift+N never manages credentials itself: its Settings shortcut opens the regular Settings window and its renderer is refused every passwords and autofill call (sway)",
  deadline: 600000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Private windows refuse credential management", ["From a private window, try Passwords and Autofill; the private renderer is refused and shows no regular data."], missing);
      return;
    }
    const run = nonce("f07p");
    const desktop = await openDesktop(t);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "private-credentials", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    const saved = await shell.invoke("ArdiaPasswords.save", { args: ["", "https://login.ardia.test/", `regular-${run}`, "f07p-secret"] });
    if (!saved.ok) throw new Error(`seeding a login failed: ${saved.code}`);
    let priv = null;
    const privateWindow = async () => {
      const live = priv && (await app.shells()).some((s) => s.windowId === priv.shell.windowId) && (await desktop.windows()).some((w) => w.id === priv.window.id);
      if (!live) {
        await closeSettings(desktop, app);
        const mainWindow = await windowTitled(desktop, "Acceptance page 1");
        priv = await openPrivateByKeys(desktop, app, mainWindow, shell);
      }
      priv.window = (await desktop.windows()).find((w) => w.id === priv.window.id) ?? priv.window;
      return priv;
    };
    await t.check("Ctrl+, in the private window opens the regular profile's Settings window, not a private one", async () => {
      await closeSettings(desktop, app);
      const source = await privateWindow();
      await openSettingsWindowFrom(t, desktop, app, source);
      const info = await until(async () => (await app.shells()).find((s) => s.windowId === "settings") ?? false, { timeout: 10000, label: "the Settings renderer's identity" });
      await desktopShot(t, desktop, "private-settings");
      if (info.privateWindow || info.pageProfile) throw new Error(`Settings runs as ${JSON.stringify({ privateWindow: info.privateWindow, pageProfile: info.pageProfile })}`);
      await closeSettings(desktop, app);
      return { profile: info.profileId };
    }, { timeout: 180000 });
    await t.check("typing Passwords into the private window's command bar offers no saved login, and the private renderer never shows the regular login", async () => {
      await closeSettings(desktop, app);
      const source = await privateWindow();
      await focusSourceWindow(desktop, source.window, source.shell);
      await desktop.key("ctrl+l");
      await until(async () => (await commandBarText(source.shell)).tag === "INPUT", { timeout: 10000, label: "the private command bar focused" });
      await desktop.type("passwords");
      const typed = await until(async () => { const c = await commandBarText(source.shell); return c.active?.includes("passwords") ? c : false; }, { timeout: 15000, label: "passwords in the private command bar" });
      const lines = await until(async () => { const l = await shellLines(source.shell); return l.some((x) => x.includes("passwords ardia suggestion") || /^passwords$/i.test(x)) ? l : false; }, { timeout: 15000, label: "the command bar's rows for passwords" }).catch(() => shellLines(source.shell));
      await desktopShot(t, desktop, "private-command-bar");
      await desktop.key("escape");
      if (lines.some((l) => l.includes(`regular-${run}`))) throw new Error("the private window shows the regular profile's login");
      return { typed: typed.active, offered: lines.filter((l) => /password/i.test(l)).slice(0, 6) };
    }, { timeout: 180000 });
    await t.check("the private window's renderer gets ERR_PROFILE_PRIVATE for passwords and autofill calls, while the same calls answer in the regular window", async () => {
      const source = await privateWindow();
      const own = source.shell.pageProfile;
      const calls = [
        ["typed", "ArdiaPasswords.list", (p) => [p]],
        ["typed", "ArdiaPasswords.status", (p) => [p]],
        ["typed", "ArdiaAutofill.addresses", (p) => [p]],
        ["generic", "passwords.list", null],
        ["generic", "autofill.addresses", null],
      ];
      const ask = async (target, profile) => {
        const out = {};
        for (const [kind, name, args] of calls) {
          const reply = kind === "typed" ? await target.invoke(name, { args: args(profile) }) : await target.call(name, {}, profile);
          out[name] = reply.ok ? "ok" : reply.code;
        }
        return out;
      };
      const privateResults = await ask(source.shell, own);
      const regularResults = await ask(shell, "");
      const control = ["ArdiaPasswords.status", "passwords.list", "autofill.addresses"].filter((name) => regularResults[name] !== "ok");
      if (control.length) throw new Error(`the regular window's control calls failed: ${JSON.stringify(regularResults)}`);
      const wrong = Object.entries(privateResults).filter(([, code]) => code !== "ERR_PROFILE_PRIVATE");
      if (wrong.length) throw new Error(`not refused as private: ${JSON.stringify(privateResults)} (profile ${own})`);
      return { private: privateResults, regular: regularResults };
    }, { timeout: 180000 });
    await closeSettings(desktop, app).catch(() => {});
    await t.stop(app);
  },
};

const BLOCKED_HOST = "news.ardia.test";

async function sitePanelToggle(shell) {
  return shell.eval(`(() => { const lines = document.body.innerText.split("\\n").map((l) => l.trim()); const text = lines.find((l) => /block/i.test(l) && /ads|track|content/i.test(l)); if (!text) return null; const label = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === text && n.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0]; if (!label) return null; const box = label.getBoundingClientRect(); const mid = box.top + box.height / 2; const c = [...document.querySelectorAll('[tabindex], [role], button, input')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 10 && r.width < 80 && r.height > 10 && r.height < 40 && r.left > box.right - 4 && Math.abs(r.top + r.height / 2 - mid) < 20; }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0]; const r = (c ?? label).getBoundingClientRect(); return { text, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

export const isolatedSitePanelDesktop = {
  id: "S108D",
  issue: 108,
  desktop: true,
  title: "The site panel in an isolated profile's window turns the blocker off for a site; Settings › Privacy and the default profile's windows follow (sway)",
  deadline: 600000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing || !blockerAvailable(t)) {
      t.manual("The site panel acts the same in an isolated window", ["Turn the blocker off for a site from an isolated window's site panel; Settings › Privacy lists it and default windows load its ads."], missing ?? "the package has no content blocker");
      return;
    }
    const run = nonce("s108d");
    const desktop = await openDesktop(t);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "isolated-panel", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    await blockerReady(shell);
    const work = await shell.state(`return s.createProfile({ name: ${js(`Panel ${run.slice(-4)}`)} });`);
    let isolated = null;
    const isolatedWindow = async () => {
      const live = isolated && (await app.shells()).some((s) => s.windowId === isolated.shell.windowId) && (await desktop.windows()).some((w) => w.id === isolated.window.id);
      if (!live) {
        await closeSettings(desktop, app);
        isolated = await openIsolated(app, shell, desktop, work, t.fixtures.url.page(2, run));
      }
      isolated.window = (await desktop.windows()).find((w) => w.id === isolated.window.id) ?? isolated.window;
      const tab = await until(() => isolated.shell.activeTabId(), { timeout: 15000, label: "the isolated window's tab" });
      return { ...isolated, tab, state: { profileId: work, shell: isolated.shell, app } };
    };
    const allowed = async () => (await call(shell, "contentBlocker.state")).allowedHosts.includes(BLOCKED_HOST);
    await t.check("the isolated window blocks the ad image", async () => {
      if (await allowed()) await call(shell, "contentBlocker.setAllowed", { host: BLOCKED_HOST, allowed: false });
      const source = await isolatedWindow();
      return expectBlocked(source.state, source.tab, BLOCKED_HOST, t, true, "the ad blocked in the isolated window");
    }, { timeout: 180000 });
    await t.check("turning blocking off for the site in the isolated window's site panel lets its ads load there", async () => {
      await closeSettings(desktop, app);
      if (await allowed()) await call(shell, "contentBlocker.setAllowed", { host: BLOCKED_HOST, allowed: false });
      const source = await isolatedWindow();
      await expectBlocked(source.state, source.tab, BLOCKED_HOST, t, true, "the ad blocked before the panel is used");
      await focusSourceWindow(desktop, source.window, source.shell);
      const icon = await until(async () => (await source.shell.labels()).find((l) => /secure|Connection|Site/i.test(l) && !/Clear/.test(l)) ?? false, { timeout: 15000, label: "the site icon in the address field" });
      const r = await labelRect(source.shell, icon);
      const frame = await currentRect(desktop, source.window);
      await desktop.click(frame.x + r.x, frame.y + r.y);
      const control = await until(() => sitePanelToggle(source.shell), { timeout: 15000, label: "the site panel's blocking control" }).catch(async (error) => {
        await desktopShot(t, desktop, "isolated-site-panel");
        throw new Error(`${error.message}; window ${JSON.stringify((await shellLines(source.shell)).slice(0, 40))}`);
      });
      await desktopShot(t, desktop, "isolated-site-panel");
      await desktop.click(frame.x + control.x, frame.y + control.y);
      await until(allowed, { timeout: 15000, label: `${BLOCKED_HOST} excepted after the panel toggle` }).catch(async (error) => {
        await desktopShot(t, desktop, "isolated-site-panel-off");
        throw new Error(`${error.message}; allowed ${JSON.stringify((await call(shell, "contentBlocker.state")).allowedHosts)}`);
      });
      await desktopShot(t, desktop, "isolated-site-panel-off");
      await desktop.key("escape");
      await expectBlocked(source.state, source.tab, BLOCKED_HOST, t, false, "the ad loading in the isolated window");
      return { control: control.text };
    }, { timeout: 180000 });
    await t.check("Settings › Privacy lists the site, and the default profile's window loads its ads", async () => {
      await closeSettings(desktop, app);
      const setup = await allowed() ? "excepted by the previous check" : "excepted through the bridge because the previous check didn't";
      if (!(await allowed())) await call(shell, "contentBlocker.setAllowed", { host: BLOCKED_HOST, allowed: true });
      const mainWindow = await windowTitled(desktop, "Acceptance page 1");
      const { settings } = await openSettingsFrom(t, desktop, app, { window: mainWindow, shell }, "Privacy & Security", "document.body.innerText.includes('Site permissions')");
      await settings.waitFor(`document.body.innerText.includes(${js(BLOCKED_HOST)})`, { timeout: 20000, label: "the site in Settings › Privacy" }).catch(async (error) => {
        await desktopShot(t, desktop, "privacy-exceptions");
        throw new Error(`${error.message}; pane ${JSON.stringify((await shellLines(settings)).slice(14, 50))}`);
      });
      await desktopShot(t, desktop, "privacy-exceptions");
      await closeSettings(desktop, app);
      const mainTab = await until(() => shell.activeTabId(), { timeout: 15000, label: "the default window's tab" });
      await expectBlocked({ profileId: "default", shell, app }, mainTab, BLOCKED_HOST, t, false, "the ad loading in the default window");
      return { listed: true, setup };
    }, { timeout: 180000 });
    await closeSettings(desktop, app).catch(() => {});
    await t.stop(app);
  },
};

export const swipeDesktop = {
  id: "W70D",
  issue: 70,
  desktop: true,
  title: "Two-finger swipes over the sidebar (finger-source horizontal scroll through the compositor) page to a shared profile in place and bring an isolated profile's own window forward (sway)",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Swiping toward an isolated profile", ["Swipe with two fingers over the sidebar toward a shared and an isolated profile."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "swipe", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    const profiles = await shell.state("return { side: s.createProfile({ name: 'Side', shareWith: 'default' }), work: s.createProfile({ name: 'Work' }) };");
    const order = await shell.state("return s.profileOrder;");
    if (order.join() !== ["default", profiles.side, profiles.work].join()) throw new Error(`profile order ${JSON.stringify(order)}`);
    const window = await windowTitled(desktop, "Acceptance page 1");
    const swipe = async (distance) => {
      await focusShell(desktop, window, shell);
      const frame = await currentRect(desktop, window);
      await desktop.swipe(frame.x + 90, frame.y + Math.round(frame.height * 0.45), distance, { steps: 20, interval: 16 });
    };
    await t.check("a swipe toward the shared-data profile pages the sidebar to it in this window", async () => {
      await swipe(300);
      const current = await shell.waitState(`return s.windows[windowId]?.profileId === ${js(profiles.side)} || null;`, { timeout: 6000, label: "the shared profile in place" }).catch(async (error) => {
        throw new Error(`${error.message}; the window is on ${await shell.state("return s.windows[windowId]?.profileId;")}`);
      });
      await desktopShot(t, desktop, "swipe-shared");
      if ((await desktop.windows()).length !== 1) throw new Error("the swipe opened a window");
      return { current };
    }, { critical: true });
    let workWindow;
    await t.check("swiping on toward the isolated profile never shows it in this window and brings its own window forward", async () => {
      await shell.eval(`(() => { globalThis.__w70 = []; globalThis.__w70Stop?.(); const tick = () => { globalThis.__w70.push(ardiaLinux.store.getState().windows[${js(shell.windowId)}]?.profileId); globalThis.__w70Timer = setTimeout(tick, 16); }; tick(); globalThis.__w70Stop = () => clearTimeout(globalThis.__w70Timer); return true; })()`);
      const known = await desktop.windows();
      const shells = await liveShells(app);
      await swipe(150);
      const opened = await openedWindow(desktop, app, known, shells, { label: "the isolated profile's window" });
      workWindow = opened.window;
      await waitFocused(desktop, (w) => w.id === opened.window.id, { label: "the isolated profile's window focused" });
      const seen = await shell.eval("globalThis.__w70Stop(), [...new Set(globalThis.__w70)]");
      if (seen.includes(profiles.work)) throw new Error(`this window showed the isolated profile: ${JSON.stringify(seen)}`);
      const own = await shell.state("return s.windows[windowId]?.profileId;");
      if (own !== profiles.side) throw new Error(`this window ended on ${own}`);
      if (opened.shell.pageProfile !== profiles.work) throw new Error(`the new window hosts ${opened.shell.pageProfile}`);
      await desktopShot(t, desktop, "swipe-isolated");
      return { seen, opened: opened.shell.windowId };
    });
    await t.check("swiping toward it again focuses the existing isolated window instead of opening another", async () => {
      const count = (await desktop.windows()).length;
      await swipe(150);
      await waitFocused(desktop, (w) => w.id === workWindow.id, { timeout: 8000, label: "the existing isolated window focused" });
      await delay(1500);
      if ((await desktop.windows()).length !== count) throw new Error("a second isolated window opened");
      return { windows: count };
    });
    await t.stop(app);
  },
};

const HEADER = { toolbar: { x: 700, y: 12 }, sidebar: { x: 140, y: 8 } };

function headerChecks({ x11 }) {
  const label = x11 ? "openbox" : "sway";
  return async (t) => {
    const desktop = await openDesktop(t, { x11 });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "header", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)], frame: [100, 100, 1200, 800] }] }) });
    const window = await windowTitled(desktop, "Acceptance page 1");
    if (!x11) await desktop.command(`[con_id=${window.id}] floating enable, resize set 1200 800, move position 100 100`);
    await delay(1000);
    const rect = async () => (await desktop.windows()).find((w) => w.id === window.id).rect;
    const drag = async (point) => {
      const before = await rect();
      const hit = await shell.eval(`document.elementsFromPoint(${point.x}, ${point.y}).slice(0, 3).map((n) => n.tagName + (n.getAttribute('aria-label') ? ':' + n.getAttribute('aria-label') : ''))`);
      if (hit.some((h) => /BUTTON|INPUT/.test(h))) throw new Error(`the point ${JSON.stringify(point)} is on a control: ${JSON.stringify(hit)}`);
      const from = { x: before.x + point.x, y: before.y + point.y };
      const to = { x: from.x + 150, y: from.y + 80 };
      await desktop.pointerMove(from.x, from.y);
      await desktop.pointerPress();
      await delay(150);
      for (let i = 1; i <= 12; i++) {
        await desktop.pointerMove(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
        await delay(30);
      }
      await delay(150);
      await desktop.pointerRelease();
      await delay(800);
      const after = await rect();
      return { before, after, moved: { x: after.x - before.x, y: after.y - before.y } };
    };
    const doubleClick = async (point) => {
      const before = await rect();
      const at = { x: before.x + point.x, y: before.y + point.y };
      if (x11) await desktop.xdotool(["mousemove", String(Math.round(at.x)), String(Math.round(at.y)), "click", "--repeat", "2", "--delay", "80", "1"]);
      else {
        await desktop.click(at.x, at.y);
        await delay(80);
        await desktop.click(at.x, at.y);
      }
      await delay(1500);
      const after = await rect();
      const state = x11 ? await desktop.run("xprop", ["-id", String(window.id), "_NET_WM_STATE"]).catch(() => "") : "";
      return { before, after, maximized: x11 ? /MAXIMIZED_VERT/.test(state) && /MAXIMIZED_HORZ/.test(state) : null };
    };
    const moves = (result) => Math.abs(result.moved.x - 150) < 40 && Math.abs(result.moved.y - 80) < 40;
    await t.check(`${label}: dragging the toolbar's empty strip moves the window`, async () => {
      const result = await drag(HEADER.toolbar);
      if (!moves(result)) throw new Error(`the window moved by ${JSON.stringify(result.moved)}`);
      return result.moved;
    });
    await t.check(`${label}: dragging the sidebar header moves the window`, async () => {
      const result = await drag(HEADER.sidebar);
      await desktopShot(t, desktop, `${label}-sidebar-drag`);
      if (!moves(result)) throw new Error(`the window moved by ${JSON.stringify(result.moved)} (#254)`);
      return result.moved;
    });
    await t.check(`${label}: right after a header drag the page gets hover and wheel input, not the header`, async () => {
      const page = await app.pageSession((x) => x.url === t.fixtures.url.page(1), { label: "the dragged window's page" });
      try {
        await evaluate(page, `(() => { window.__afterDrag = { moves: 0, wheels: 0 }; addEventListener("mousemove", () => window.__afterDrag.moves++, true); addEventListener("wheel", () => window.__afterDrag.wheels++, { capture: true, passive: true }); return true; })()`, { userGesture: false });
        await drag(HEADER.sidebar);
        const box = await rect();
        const shellMoves = await shell.eval(`(() => { window.__afterDragShell = 0; addEventListener("mousemove", () => window.__afterDragShell++, true); return true; })()`);
        for (const [dx, dy] of [[500, 300], [560, 340], [620, 380], [680, 420]]) {
          await desktop.pointerMove(box.x + dx, box.y + dy);
          await delay(120);
        }
        for (let i = 0; i < 3; i++) {
          if (x11) await desktop.xdotool(["click", "5"]);
          else await desktop.scroll(3);
          await delay(150);
        }
        await delay(500);
        const seen = await evaluate(page, "window.__afterDrag", { userGesture: false });
        const header = await shell.eval("window.__afterDragShell");
        if (!seen.moves || !seen.wheels) throw new Error(`the page saw ${seen.moves} pointer moves and ${seen.wheels} wheel events after the drag; the shell saw ${header} moves${x11 ? " (#335: no synthetic release after the WM move)" : ""}`);
        return { ...seen, shellMoves: header, armed: shellMoves };
      } finally {
        await page.close().catch(() => {});
      }
    });
    if (x11) {
      await t.check("openbox: double-clicking the toolbar's empty strip maximizes the window and again restores it", async () => {
        const max = await doubleClick(HEADER.toolbar);
        if (!max.maximized) throw new Error(`not maximized: ${JSON.stringify(max)}`);
        const restored = await doubleClick({ x: HEADER.toolbar.x, y: HEADER.toolbar.y });
        if (restored.maximized) throw new Error("the second double-click did not restore it");
        return { maximized: max.after, restored: restored.after };
      });
      await t.check("openbox: double-clicking the sidebar header maximizes the window", async () => {
        const max = await doubleClick(HEADER.sidebar);
        if (!max.maximized) throw new Error(`not maximized (#254): ${JSON.stringify(max)}`);
        return max.after;
      });
    }
    await t.stop(app);
  };
}

export const headerSway = {
  id: "F26D",
  issue: 36,
  desktop: true,
  title: "Header dragging on sway: the toolbar strip and the sidebar header move a floating window (sway has no maximized state, so double-click is checked on openbox)",
  deadline: 180000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["grim"] });
    if (missing) {
      t.manual("Custom header dragging moves the window", ["Drag the window by its sidebar header; it moves."], missing);
      return;
    }
    await headerChecks({ x11: false })(t);
  },
};

export const headerX11 = {
  id: "F26X",
  issue: 36,
  desktop: true,
  title: "Header dragging and double-click maximize on Xvfb + openbox: the toolbar strip and the sidebar header",
  deadline: 180000,
  async run(t) {
    const missing = await desktopUnavailable({ x11: true });
    if (missing) {
      t.manual("Custom header dragging moves the window", ["On X11, drag the window by its sidebar header; it moves and double-click maximizes."], missing);
      return;
    }
    await headerChecks({ x11: true })(t);
  },
};

export default [profilesDesktop, privateCredentialsDesktop, isolatedSitePanelDesktop, swipeDesktop, headerSway, headerX11];
