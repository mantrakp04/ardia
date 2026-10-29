import { startBrowser } from "../lib/flows.mjs";
import { until } from "../lib/util.mjs";

const MACOS = /\bMac\b|macOS|Keychain|Touch ID|Applications folder/;

async function paneText(settings, pane, marker) {
  await settings.clickText(pane, { timeout: 8000 });
  return until(async () => {
    const text = await settings.text();
    return text.includes(marker) ? text : false;
  }, { timeout: 10000, label: `the ${pane} pane` });
}

export default {
  id: "S104",
  issue: 104,
  title: "Passwords and Autofill describe Linux storage and system authentication, never macOS",
  deadline: 180000,
  manual: [
    { name: "Wording reads naturally on the desktop", steps: ["Open Settings › Passwords and Settings › Autofill in a desktop session.", "The notice and 'Storage on this computer' rows sit above the panes and name the keyring in use; Unlock asks for your system password."], reason: "automated in S104D" },
  ],
  async run(t) {
    const { app, shell } = await startBrowser(t, { name: "wording" });
    let settings;
    await t.check("Settings opens", async () => {
      await shell.command("openSettings");
      settings = await app.shell("settings", { timeout: 20000 });
      await until(async () => (await settings.text()).includes("General"), { timeout: 10000, label: "Settings navigation" });
      return true;
    }, { critical: true });
    await t.check("the Passwords pane names Linux storage and authentication", async () => {
      const text = await paneText(settings, "Passwords", "Saved on this computer");
      await t.evidence("passwords-pane", { text });
      if (MACOS.test(text)) throw new Error(`macOS wording: ${text.match(MACOS)[0]}`);
      for (const want of ["Storage on this computer", "system keyring", "system password"]) if (!text.includes(want)) throw new Error(`missing "${want}"`);
      return { length: text.length };
    });
    await t.check("the Autofill pane names Linux storage", async () => {
      const text = await paneText(settings, "Autofill", "Card numbers are encrypted by Chromium");
      await t.evidence("autofill-pane", { text });
      if (MACOS.test(text)) throw new Error(`macOS wording: ${text.match(MACOS)[0]}`);
      return { length: text.length };
    });
    await t.screenshot(settings, "autofill");
  },
};
