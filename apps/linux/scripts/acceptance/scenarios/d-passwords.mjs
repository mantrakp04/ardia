import { setTimeout as delay } from "node:timers/promises";
import { clickTextIn, desktopShot, desktopUnavailable, openDesktop, openSettingsWindow, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { startKeyring } from "../lib/desktopKeyring.mjs";
import { startPolkit } from "../lib/desktopServices.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const ACTION = "dev.ardia.linux.reauthenticate";
const ORIGIN = "https://secure.ardia.test";
const HOST = "secure.ardia.test";
const LOCKED = "Passwords are locked";

const prompts = async (polkit) => (await polkit.calls()).filter((c) => c.action === ACTION && c.flags & 1);
const paneText = (settings) => settings.eval("document.body.innerText", { timeout: 3000 });

async function unlockOnce(desktop, settingsWindow, settings, polkit, { expectUnlocked, wait = 15000 }) {
  const before = (await prompts(polkit)).length;
  await clickTextIn(desktop, settingsWindow, settings, "Unlock");
  await until(async () => (await prompts(polkit)).length > before, { timeout: 10000, label: "a polkit CheckAuthorization with user interaction" });
  const text = await until(async () => {
    const body = await paneText(settings);
    if (expectUnlocked) return body.includes(HOST) && !body.includes(LOCKED) ? body : false;
    return body;
  }, { timeout: wait, label: expectUnlocked ? "the password list" : "the pane after the answer" });
  return { text, calls: (await prompts(polkit)).slice(before) };
}

export default {
  id: "F07D",
  issue: 17,
  desktop: true,
  title: "Settings › Passwords asks polkit through a mocked authority on a private system bus: deny, dismiss, timeout and allow",
  deadline: 480000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock"] });
    if (missing) {
      t.manual("Unlock asks polkit and honours each answer", ["With a polkit agent, Settings › Passwords › Unlock: deny, dismiss and a two-minute wait each leave the passwords locked; allowing lists them and opening one inside five minutes asks nothing more."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const polkit = await startPolkit(desktop, { mode: "deny" });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "polkit", session: sessionSeed() });
    await t.check("the status reports system authentication available through polkit", async () => {
      const status = await shell.invoke("ArdiaPasswords.status", { args: [""] });
      if (!status.ok || status.value?.reauth !== true) throw new Error(JSON.stringify(status));
      const probes = (await polkit.calls()).filter((c) => c.action === ACTION && !(c.flags & 1));
      return { reauth: status.value.reauth, probes: probes.length };
    }, { critical: true });
    const saved = await shell.invoke("ArdiaPasswords.save", { args: ["", ORIGIN, "acceptance-user", "acceptance-secret-1"] });
    if (!saved.ok) throw new Error(`seeding a password failed: ${JSON.stringify(saved)}`);
    const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Passwords" });
    await settings.waitFor(`document.body.innerText.includes(${JSON.stringify(LOCKED)})`, { timeout: 10000, label: "the locked Passwords pane" });
    await t.check("a denied prompt keeps the passwords locked", async () => {
      await polkit.call("SetMode", ["deny"]);
      const { text, calls } = await unlockOnce(desktop, window, settings, polkit, { expectUnlocked: false });
      await delay(1000);
      const body = await paneText(settings);
      if (!body.includes(LOCKED) || body.includes("acceptance-user")) throw new Error(`the pane changed after a denial: ${body.slice(0, 400)}`);
      return { calls: calls.length, flags: calls[0]?.flags, text: text.includes(LOCKED) };
    });
    await t.check("a dismissed prompt keeps the passwords locked", async () => {
      await polkit.call("SetMode", ["dismiss"]);
      await unlockOnce(desktop, window, settings, polkit, { expectUnlocked: false });
      await delay(1000);
      const body = await paneText(settings);
      if (!body.includes(LOCKED) || body.includes("acceptance-user")) throw new Error(`the pane changed after a dismissal: ${body.slice(0, 400)}`);
      return { locked: true };
    });
    await t.check("a prompt left open for two minutes expires, is cancelled at the authority, and keeps the passwords locked", async () => {
      await polkit.call("SetMode", ["hang"]);
      const started = Date.now();
      const { calls } = await unlockOnce(desktop, window, settings, polkit, { expectUnlocked: false, wait: 2000 });
      const cancellation = calls[0]?.cancellation;
      if (!cancellation) throw new Error(`the prompt carried no cancellation id: ${JSON.stringify(calls)}`);
      await until(async () => (await polkit.calls()).some((c) => c.cancel === cancellation), { timeout: 150000, interval: 1000, label: "CancelCheckAuthorization after the prompt timeout" });
      const waited = Date.now() - started;
      await delay(1000);
      const body = await paneText(settings);
      if (!body.includes(LOCKED) || body.includes("acceptance-user")) throw new Error(`the pane changed after the timeout: ${body.slice(0, 400)}`);
      if (waited < 110000) throw new Error(`cancelled after ${waited} ms, before the two-minute prompt timeout`);
      return { waitedMs: waited };
    }, { timeout: 170000 });
    await t.check("an allowed prompt unlocks the list and opening a password inside the grant asks nothing more", async () => {
      await polkit.call("SetMode", ["allow"]);
      const { calls } = await unlockOnce(desktop, window, settings, polkit, { expectUnlocked: true });
      await desktopShot(t, desktop, "passwords-unlocked");
      const count = (await prompts(polkit)).length;
      await clickTextIn(desktop, window, settings, HOST);
      await settings.waitFor("document.body.innerText.includes('Website') && document.body.innerText.includes('acceptance-user')", { timeout: 10000, label: "the password sheet" });
      await settings.waitFor("!document.body.innerText.includes('…')", { timeout: 10000, label: "the password to load" }).catch(() => {});
      await delay(800);
      if ((await prompts(polkit)).length !== count) throw new Error("opening a password inside the grant asked polkit again");
      const masked = await settings.eval("document.body.innerText.includes('•')");
      await desktopShot(t, desktop, "password-sheet");
      return { unlockCalls: calls.length, masked };
    });
    await t.stop(app);
  },
};

const KEYRING_REASON = "Your keyring didn't answer";
const FLAGGED = "Passwords aren't encrypted with your keyring";

async function keyringPane(t, state, { polkit = false } = {}) {
  const desktop = await openDesktop(t, { name: `keyring-${state}` });
  const keyring = state === "absent" ? null : await startKeyring(desktop, { state });
  if (polkit) await startPolkit(desktop, { mode: "deny" });
  const { app, shell } = await startDesktopBrowser(t, desktop, { name: `keyring-${state}`, session: sessionSeed(), extraArgs: ["--password-store=gnome-libsecret"] });
  try {
    const status = await shell.invoke("ArdiaPasswords.status", { args: [""] });
    const { settings } = await openSettingsWindow(desktop, app, shell, { pane: "Passwords" });
    const lines = await until(async () => {
      const body = (await paneText(settings)).split("\n").map((l) => l.trim()).filter(Boolean);
      return body.includes("Storage on this computer") ? body : false;
    }, { timeout: 20000, label: "the Passwords pane's storage row" });
    await desktopShot(t, desktop, `keyring-${state}`);
    const start = lines.lastIndexOf("Passwords", lines.indexOf("Storage on this computer"));
    return { status: status.value ?? status, pane: lines.slice(Math.max(0, start), lines.indexOf("Storage on this computer") + 2), saved: await shell.invoke("ArdiaPasswords.save", { args: ["", ORIGIN, `keyring-${state}`, "acceptance-secret-2"] }), items: keyring ? await keyring.items().catch(() => null) : null };
  } finally {
    await t.stop(app);
    await keyring?.stop();
    await desktop.stop();
  }
}

export const f07Keyring = {
  id: "F07K",
  issue: 17,
  desktop: true,
  title: "With a locked or absent Secret Service, Settings › Passwords flags the keyring instead of showing a plain empty vault (gnome-libsecret)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["keyring"] });
    if (missing) {
      t.manual("A locked keyring is reported as unavailable", ["Start Ardia with --password-store=gnome-libsecret and a locked or absent Secret Service: Settings › Passwords names the keyring problem instead of showing a plain empty vault."], missing);
      return;
    }
    for (const state of ["absent", "locked"]) {
      await t.check(`with the Secret Service ${state}, the Passwords pane names the keyring problem`, async () => {
        const { status, pane } = await keyringPane(t, state);
        const text = pane.join("\n");
        if (!text.includes(KEYRING_REASON)) throw new Error(`no keyring reason in the pane: ${JSON.stringify(pane)}`);
        if (!pane.includes(FLAGGED) && !pane.includes("Passwords are unavailable")) throw new Error(`the pane has no keyring notice title: ${JSON.stringify(pane)}`);
        if (/No saved passwords/.test(text)) throw new Error("the pane shows an empty vault next to the notice");
        return { title: pane.find((l) => l === FLAGGED || l === "Passwords are unavailable"), protection: status.protection, fallback: status.protectionFallback };
      }, { timeout: 120000 });
    }
  },
};

export const s102Keyring = {
  id: "S102D",
  issue: 102,
  desktop: true,
  title: "A running gnome-keyring is reported as the keyring and a locked one is flagged, on a private session bus",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["keyring"] });
    if (missing) {
      t.manual("A working keyring is reported as the keyring", ["Start Ardia with --password-store=gnome-libsecret in a session with an unlocked Secret Service: Settings › Passwords names the keyring as the storage and nothing is flagged."], missing);
      t.manual("A keyring that stops answering is flagged", ["Start Ardia with --password-store=gnome-libsecret and a locked Secret Service: Settings › Passwords flags that new passwords are only obfuscated."], missing);
      return;
    }
    await t.check("an unlocked gnome-keyring is reported as the keyring and new passwords are encrypted with it", async () => {
      const { status, pane, saved, items } = await keyringPane(t, "unlocked");
      if (status.protection !== "keyring" || status.protectionFallback) throw new Error(`status ${JSON.stringify(status)}`);
      const storage = pane[pane.indexOf("Storage on this computer") + 1] ?? "";
      if (!/encrypted with a key from/.test(storage) || !/Secret Service/i.test(storage)) throw new Error(`storage row ${JSON.stringify(storage)}`);
      if (pane.includes(FLAGGED)) throw new Error("the pane flags a working keyring");
      if (!saved.ok) throw new Error(`saving with the keyring failed: ${JSON.stringify(saved)}`);
      if (!Array.isArray(items) || !items.length) throw new Error(`the login keyring holds no item after a save with the keyring: ${JSON.stringify(items)}`);
      return { protection: status.protection, storage, keyringItems: Array.isArray(items) ? items.length : items };
    }, { timeout: 120000 });
    await t.check("a locked gnome-keyring is flagged in Settings and falls back to the built-in key", async () => {
      const { status, pane } = await keyringPane(t, "locked");
      if (!status.protectionFallback) throw new Error(`status ${JSON.stringify(status)}`);
      if (!pane.includes(FLAGGED) || !pane.join(" ").includes(KEYRING_REASON)) throw new Error(`pane ${JSON.stringify(pane)}`);
      return { protection: status.protection, fallback: status.protectionFallback };
    }, { timeout: 120000 });
  },
};
