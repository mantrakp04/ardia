import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clickTextIn, desktopShot, desktopUnavailable, openDesktop, openSettingsWindow, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { startPolkit } from "../lib/desktopServices.mjs";
import { answerPrompter, enablePrompter, prompterMissing, prompterWindow, startKeyring } from "../lib/desktopKeyring.mjs";
import { continueToDone, freshenHistory, marks, openImportWindow, summaryLine } from "../lib/desktopImport.mjs";
import { openPane, paneLines, paneText } from "../lib/desktopSettings.mjs";
import { savedLogins, writeImportFixtures } from "../lib/importFixtures.mjs";
import { KEYRING_SECRET, writeFollowupFixtures } from "../lib/importFollowupFixtures.mjs";
import { sessionSeed, writeProfileSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const SAFE_STORAGE = { label: "Chrome Safe Storage", attributes: { application: "chrome", "xdg:schema": "chrome_libsecret_os_crypt_password_v2" }, secret: KEYRING_SECRET };

async function importDesktop(t, name, { keyring, writeFixtures, prompter = false }) {
  const desktop = await openDesktop(t, { name });
  await desktop.command("layout tabbed");
  const polkit = await startPolkit(desktop, { mode: "allow" });
  const ring = keyring ? await startKeyring(desktop, { state: keyring, items: [SAFE_STORAGE] }) : null;
  if (prompter) await enablePrompter(desktop);
  const scratch = await t.scratch(`${name}-profile`);
  await writeProfileSeed(scratch, { session: sessionSeed() });
  const fixtures = await writeFixtures(join(scratch, "home"));
  const { app, shell } = await startDesktopBrowser(t, desktop, { scratch, label: name });
  return { desktop, polkit, ring, scratch, fixtures, app, shell };
}

const bookmarkTitles = (shell) => shell.state("return Object.values(s.bookmarks?.nodes ?? {}).filter((n) => n.kind !== 'folder').map((n) => n.title).sort();");
const historyUrls = (shell) => shell.state("return (s.history?.['']?.list ?? []).map((h) => h.url).filter((u) => u.includes('.ardia.test')).sort();");

async function passwordRows(desktop, settingsWindow, settings, hosts) {
  await openPane(desktop, settingsWindow, settings, "Passwords", "Import CSV…");
  if ((await paneText(settings)).includes("Passwords are locked")) await clickTextIn(desktop, settingsWindow, settings, "Unlock");
  return until(async () => {
    const lines = await paneLines(settings);
    return hosts.every((h) => lines.includes(h)) ? lines.filter((l) => hosts.includes(l)) : false;
  }, { timeout: 15000, label: `${hosts.join(", ")} in Settings › Passwords` });
}

export const f12Window = {
  id: "F12W",
  issue: 22,
  desktop: true,
  title: "The Import window, clicked through in a desktop session with Chrome and Firefox profiles in HOME: defaults, Firefox's kinds, Done counts, passwords in Settings, bookmarks and history in the browser",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock"] });
    if (missing) {
      t.manual("Import window click-through", ["Open Settings › General › Import… with a Chrome and a Firefox profile in HOME: Chrome is selected with Bookmarks, History and Passwords; Continue imports them; Done shows the counts; Firefox offers Bookmarks and History only."], missing);
      return;
    }
    const env = await importDesktop(t, "chrome-firefox", { writeFixtures: async (home) => {
      const fixtures = await writeImportFixtures(home, { largeHistory: 50 });
      freshenHistory(home);
      return fixtures;
    } });
    const { desktop, app, shell } = env;
    let ui = await openImportWindow(desktop, app, shell);
    await t.check("Google Chrome is listed first and selected, with Bookmarks, History and Passwords ticked", async () => {
      const lines = await paneLines(ui.importer);
      const state = await marks(ui.importer);
      if (lines.indexOf("Google Chrome") < 0 || lines.indexOf("Google Chrome") > lines.indexOf("Firefox")) throw new Error(`order ${JSON.stringify(lines.slice(0, 8))}`);
      if (state["Google Chrome"] !== true || state.Firefox !== false) throw new Error(`selection ${JSON.stringify(state)}`);
      for (const kind of ["Bookmarks", "History", "Passwords"]) if (state[kind] !== true) throw new Error(`${kind} isn't ticked: ${JSON.stringify(state)}`);
      await desktopShot(t, desktop, "import-choose-chrome");
      return state;
    });
    await t.check("choosing Firefox offers Bookmarks and History only", async () => {
      await clickTextIn(desktop, ui.importWindow, ui.importer, "Firefox");
      const state = await until(async () => {
        const s = await marks(ui.importer);
        return s.Firefox === true ? s : false;
      }, { timeout: 5000, label: "Firefox to be selected" });
      const kinds = Object.keys(state).filter((k) => ["Bookmarks", "History", "Passwords", "Cookies (stay signed in)", "Addresses and cards", "Tabs"].includes(k));
      await desktopShot(t, desktop, "import-choose-firefox");
      if (kinds.join() !== "Bookmarks,History") throw new Error(`Firefox offers ${kinds.join(", ")}`);
      await clickTextIn(desktop, ui.importWindow, ui.importer, "Google Chrome");
      await until(async () => (await marks(ui.importer))["Google Chrome"] === true, { timeout: 5000, label: "Chrome to be selected again" });
      return { kinds };
    });
    let done;
    await t.check("Continue imports the Chrome profile and the Done step shows the source's counts and the keyring-protected password it couldn't import", async () => {
      done = await continueToDone(desktop, ui.importWindow, ui.importer);
      await desktopShot(t, desktop, "import-done");
      const summary = summaryLine(done.text);
      const want = `Imported ${env.fixtures.expected.chromeLinks} bookmarks, ${env.fixtures.expected.chromeHistory} history items, ${env.fixtures.expected.chromePasswords} passwords.`;
      if (summary !== want) throw new Error(`Done says ${JSON.stringify(summary)}, want ${JSON.stringify(want)}; steps ${JSON.stringify(done.seen)}`);
      if (!/1 password protected by the system keyring wasn't imported/.test(done.text)) throw new Error(`no note for the v11 password: ${done.text.slice(0, 300)}`);
      return { summary, steps: done.seen };
    });
    await clickTextIn(desktop, ui.importWindow, ui.importer, "Finish importing").catch(() => {});
    await t.check("Settings › Passwords lists the imported passwords after unlocking", async () => {
      const rows = await passwordRows(desktop, ui.window, ui.settings, ["login-one.ardia.test", "login-two.ardia.test", "login-three.ardia.test"]);
      const stored = await savedLogins(join(env.scratch, "Default", "Login Data"), await t.tempDir("logins"));
      if (stored.some((row) => row.origin.includes("keyring.ardia.test"))) throw new Error("the keyring-protected login was stored");
      await desktopShot(t, desktop, "import-passwords");
      return { rows };
    });
    await t.check("the open browser window has the imported bookmarks and history", async () => {
      const found = await until(async () => {
        const marksNow = await bookmarkTitles(shell);
        const visits = await historyUrls(shell);
        return marksNow.length >= env.fixtures.expected.chromeLinks && visits.length >= env.fixtures.expected.chromeHistory ? { bookmarks: marksNow, history: visits } : false;
      }, { timeout: 20000, label: "the imported bookmarks and history in the open browser window" }).catch(async (error) => {
        throw new Error(`${error.message}; bookmarks ${JSON.stringify(await bookmarkTitles(shell))}, history ${JSON.stringify(await historyUrls(shell))}`);
      });
      return found;
    });
    await t.stop(app);
    await t.check("after a relaunch the browser window has the imported bookmarks and history", async () => {
      const again = await startDesktopBrowser(t, desktop, { scratch: env.scratch, label: "relaunch" });
      try {
        return await until(async () => {
          const marksNow = await bookmarkTitles(again.shell);
          const visits = await historyUrls(again.shell);
          return marksNow.length >= env.fixtures.expected.chromeLinks && visits.length >= env.fixtures.expected.chromeHistory ? { bookmarks: marksNow, history: visits } : false;
        }, { timeout: 20000, label: "the imported bookmarks and history after relaunch" }).catch(async (error) => {
          throw new Error(`${error.message}; bookmarks ${JSON.stringify(await bookmarkTitles(again.shell))}, history ${JSON.stringify(await historyUrls(again.shell))}`);
        });
      } finally {
        await t.stop(again.app);
      }
    });
  },
};

export const i111Window = {
  id: "I111W",
  issue: 111,
  desktop: true,
  title: "The Import window brings tabs, cookies, an address and a card from a Chrome profile: tabs in an Imported group, the site still signed in, Settings › Autofill lists them",
  deadline: 300000,
  async run(t) {
    const missing = (await prompterMissing()) ?? await desktopUnavailable({ needs: ["dbusmock", "keyring"] });
    if (missing) {
      t.manual("Import window click-through with tabs, cookies and autofill", ["Import Tabs, Cookies and Autofill from a Chrome profile through the Import window: Done shows the counts, tabs open in an Imported group, a site stays signed in, Settings › Autofill lists the address and card."], missing);
      return;
    }
    const env = await importDesktop(t, "followups", { keyring: "unlocked", writeFixtures: (home) => writeFollowupFixtures(home, { keyring: true }) });
    const { desktop, app, shell, fixtures } = env;
    const ui = await openImportWindow(desktop, app, shell);
    await t.check("Chrome offers Passwords, Cookies, Addresses and cards, and Tabs, all ticked", async () => {
      const state = await marks(ui.importer);
      for (const kind of ["Passwords", "Cookies (stay signed in)", "Addresses and cards", "Tabs"]) if (state[kind] !== true) throw new Error(`${kind}: ${JSON.stringify(state)}`);
      return state;
    });
    await t.check("Continue imports them and the Done step shows the counts", async () => {
      const done = await continueToDone(desktop, ui.importWindow, ui.importer);
      await desktopShot(t, desktop, "followups-done");
      const summary = summaryLine(done.text);
      const want = `Imported ${fixtures.expected.keyringPasswords} passwords, ${fixtures.expected.chromeCookies} cookies, ${fixtures.expected.addresses} address, ${fixtures.expected.cards} card, ${fixtures.expected.chromeTabs} tabs.`;
      if (summary !== want) throw new Error(`Done says ${JSON.stringify(summary)}, want ${JSON.stringify(want)}`);
      return { summary, steps: done.seen };
    });
    await clickTextIn(desktop, ui.importWindow, ui.importer, "Finish importing").catch(() => {});
    await t.check("the imported tabs open in the browser window, the unpinned one in an Imported group", async () => {
      const state = await until(async () => {
        const s = await shell.state("return { tabs: Object.values(s.tabs).filter((x) => x.windowId === windowId).map((x) => ({ url: x.url, pinned: !!x.pin })), groups: Object.values(s.groups ?? {}).map((g) => ({ title: g.title ?? g.name, urls: (g.tabIds ?? []).map((id) => s.tabs[id]?.url) })) };");
        return fixtures.tabs.every((tab) => s.tabs.some((x) => x.url === tab.url)) ? s : false;
      }, { timeout: 15000, label: "the imported tabs in the browser window" });
      const group = state.groups.find((g) => g.title === "Imported");
      if (!group?.urls.includes("https://tab-two.ardia.test/")) throw new Error(`groups ${JSON.stringify(state.groups)}`);
      await desktopShot(t, desktop, "followups-tabs");
      return state;
    });
    await t.check("a site from the imported cookies is still signed in: its next request carries both cookies", async () => {
      const url = `https://cookies.ardia.test:${t.fixtures.ports.https}/page/7`;
      const since = Date.now();
      await shell.newTab(url);
      const request = await until(() => Object.values(t.fixtures.requests).find((r) => r.host === "cookies.ardia.test" && r.path === "/page/7" && r.time >= since) ?? false, { timeout: 15000, label: "the request to cookies.ardia.test" });
      const cookie = request.headers.cookie ?? "";
      for (const [name, value] of Object.entries(fixtures.cookieValues)) if (!cookie.includes(`${name}=${value}`)) throw new Error(`the request carries ${JSON.stringify(cookie)}`);
      return { cookies: cookie.split(";").map((c) => c.trim().split("=")[0]) };
    });
    await t.check("Settings › Autofill lists the imported address and card", async () => {
      await openPane(desktop, ui.window, ui.settings, "Autofill", "Credit Cards");
      const lines = await until(async () => {
        const l = await paneLines(ui.settings);
        return l.some((x) => x.includes("Ada Acceptance")) && l.some((x) => /•••• 1111/.test(x)) ? l : false;
      }, { timeout: 10000, label: "the address and card in Settings › Autofill" });
      await desktopShot(t, desktop, "followups-autofill");
      return lines.filter((l) => /Ada Acceptance|1111|Fixture Way/.test(l));
    });
    await t.stop(app);
  },
};

async function toUnlockStep(desktop, ui) {
  await clickTextIn(desktop, ui.importWindow, ui.importer, "Continue");
  await until(async () => (await paneText(ui.importer)).includes("Unlock your data for import"), { timeout: 15000, label: "the Import window's unlock step" });
}

async function unlockWithPrompt(t, desktop, ui, { allow, shot }) {
  await clickTextIn(desktop, ui.importWindow, ui.importer, "Continue");
  const prompt = await prompterWindow(desktop, { timeout: 20000 });
  if (shot) await desktopShot(t, desktop, shot);
  await answerPrompter(desktop, prompt, { allow });
  return prompt;
}

export const i109Keyring = {
  id: "I109K",
  issue: 109,
  desktop: true,
  title: "Keyring-protected (v11) Chrome passwords through the Import window with a private gnome-keyring: Continue raises gnome-keyring's own unlock prompt; dismissed, it refuses with a note; unlocked, it imports; Skip Encrypted Data imports nothing encrypted",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "keyring"] });
    if (missing) {
      t.manual("GNOME Keyring and KWallet", ["Import passwords from a Chrome profile that uses gnome-libsecret: the system unlock prompt appears; cancelling imports none and shows the locked note; allowing imports them."], missing);
      return;
    }
    const passwordsOnly = async (desktop, ui) => {
      for (const kind of ["Cookies (stay signed in)", "Addresses and cards", "Tabs"]) {
        if ((await marks(ui.importer))[kind]) await clickTextIn(desktop, ui.importWindow, ui.importer, kind);
      }
      const state = await marks(ui.importer);
      if (!state.Passwords || state.Tabs || state["Cookies (stay signed in)"]) throw new Error(`kinds ${JSON.stringify(state)}`);
    };
    const stored = async (scratch, name) => (await savedLogins(join(scratch, "Default", "Login Data"), await t.tempDir(name))).filter((row) => row.origin.includes("ring-"));
    const env = await importDesktop(t, "keyring-locked", { keyring: "locked", prompter: true, writeFixtures: (home) => writeFollowupFixtures(home, { keyring: true }) });
    const { desktop, app, shell, ring, fixtures } = env;
    const ui = await openImportWindow(desktop, app, shell);
    await passwordsOnly(desktop, ui);
    await toUnlockStep(desktop, ui);
    await t.check("with the keyring locked, Continue raises gnome-keyring's unlock prompt; Cancel there leaves the note that the keyring didn't allow access and imports nothing", async () => {
      const prompt = await unlockWithPrompt(t, desktop, ui, { allow: false, shot: "keyring-prompt" });
      const note = await until(async () => (await paneLines(ui.importer)).find((l) => l.includes("didn't allow access")) ?? false, { timeout: 15000, label: "the locked note after the dismissed prompt" });
      await desktopShot(t, desktop, "keyring-dismissed");
      await delay(1000);
      if ((await stored(env.scratch, "dismissed")).length) throw new Error("passwords were stored after the prompt was dismissed");
      if (!(await ring.locked())) throw new Error("the keyring is unlocked after a dismissed prompt");
      return { prompt: prompt.title, note };
    });
    await t.check("Continue again raises the prompt; unlocking there imports the two keyring-protected passwords and Settings lists them", async () => {
      const prompt = await unlockWithPrompt(t, desktop, ui, { allow: true });
      const done = await until(async () => { const text = await paneText(ui.importer); return /You're all set|Partially imported|Import failed|nothing new/.test(text) ? text : false; }, { timeout: 30000, label: "the Done step after unlocking" });
      const summary = summaryLine(done);
      if (summary !== `Imported ${fixtures.expected.keyringPasswords} passwords.`) throw new Error(`Done says ${JSON.stringify(summary)}: ${done.slice(0, 300)}`);
      await clickTextIn(desktop, ui.importWindow, ui.importer, "Finish importing").catch(() => {});
      const rows = await passwordRows(desktop, ui.window, ui.settings, ["ring-one.ardia.test", "ring-two.ardia.test"]);
      await desktopShot(t, desktop, "keyring-imported");
      return { prompt: prompt.title, summary, rows };
    }, { timeout: 120000 });
    await t.stop(app);
    await t.check("Skip Encrypted Data after a dismissed prompt imports nothing encrypted and says so", async () => {
      const fresh = await importDesktop(t, "keyring-skip", { keyring: "locked", prompter: true, writeFixtures: (home) => writeFollowupFixtures(home, { keyring: true }) });
      try {
        const skip = await openImportWindow(fresh.desktop, fresh.app, fresh.shell);
        await passwordsOnly(fresh.desktop, skip);
        await toUnlockStep(fresh.desktop, skip);
        await unlockWithPrompt(t, fresh.desktop, skip, { allow: false });
        await until(async () => (await paneText(skip.importer)).includes("didn't allow access"), { timeout: 15000, label: "the locked note" });
        await clickTextIn(fresh.desktop, skip.importWindow, skip.importer, "Skip Encrypted Data");
        const done = await until(async () => {
          const text = await paneText(skip.importer);
          return /You're all set|Partially imported|Import failed|nothing new/.test(text) ? text : false;
        }, { timeout: 20000, label: "the Done step after skipping" });
        await desktopShot(t, fresh.desktop, "keyring-skipped");
        if ((await stored(fresh.scratch, "skip")).length) throw new Error("skipping stored the keyring passwords");
        if (/Imported 2 passwords/.test(done)) throw new Error(`Done claims the passwords: ${done}`);
        return { done: done.split("\n").slice(0, 4) };
      } finally {
        await t.stop(fresh.app);
        await fresh.desktop.stop();
      }
    }, { timeout: 150000 });
  },
};
