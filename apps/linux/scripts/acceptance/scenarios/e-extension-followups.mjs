import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { js, until } from "../lib/util.mjs";

export const FOLLOWUP_EXTENSION = new URL("../fixtures/extension-followups/", import.meta.url);
export const FOLLOWUP_NAME = "Ardia Follow-up Fixture";
export const SEARCH_KEYWORD = "ardiasearch";
export const ACTION_SHORTCUT = "Alt+Shift+Y";
export const COMMAND_SHORTCUT = "Alt+Shift+U";

export const ECHO_HOST_SOURCE = `const location = process.env.ARDIA_ECHO_LOCATION ?? "";
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (buffer.length < 4 + size) return;
    const message = JSON.parse(buffer.subarray(4, 4 + size).toString("utf8"));
    buffer = buffer.subarray(4 + size);
    const reply = Buffer.from(JSON.stringify({ echo: message, location, origin: process.argv[2] ?? null }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(reply.length, 0);
    process.stdout.write(Buffer.concat([header, reply]));
  }
});
process.stdin.on("end", () => process.exit(0));
`;

export async function prepareFollowupExtension(dir) {
  await cp(FOLLOWUP_EXTENSION, dir, { recursive: true });
  return dir;
}

export async function installEchoHost({ folder, scripts, name, location, extensionIds, node = process.execPath }) {
  await mkdir(folder, { recursive: true });
  await mkdir(scripts, { recursive: true });
  const script = join(scripts, `${name}-${location}.mjs`);
  const launcher = join(scripts, `${name}-${location}.sh`);
  await writeFile(script, ECHO_HOST_SOURCE);
  await writeFile(launcher, `#!/bin/sh\nARDIA_ECHO_LOCATION=${JSON.stringify(location)} exec ${JSON.stringify(node)} ${JSON.stringify(script)} "$@"\n`);
  await chmod(launcher, 0o755);
  const manifest = { name, description: "Ardia acceptance echo host", path: launcher, type: "stdio", allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`) };
  const file = join(folder, `${name}.json`);
  await writeFile(file, JSON.stringify(manifest, null, 2));
  return file;
}

export const sendNative = (session, name, message) =>
  evaluate(session, `chrome.runtime.sendNativeMessage(${js(name)}, ${js(message)}).then((reply) => ({ ok: true, reply }), (error) => ({ ok: false, error: String(error?.message ?? error) }))`);

export const followupOf = (reply) => (reply.ok ? reply.value.extensions ?? [] : []).find((x) => x.name === FOLLOWUP_NAME) ?? null;

async function loaded(t, name) {
  const fixture = await prepareFollowupExtension(await t.scratch(`${name}-extension`));
  const state = await startBrowser(t, { name, extensions: true, extraArgs: [`--load-extension=${fixture}`] });
  const ext = await until(async () => followupOf(await state.shell.call("extensions.list", {})) ?? false, { timeout: 20000, label: "the follow-up fixture in extensions.list" });
  const target = await until(async () => (await state.app.targets()).find((x) => x.type === "service_worker" && x.url.startsWith(`chrome-extension://${ext.id}/`)) ?? false,
    { timeout: 20000, label: "the follow-up fixture's service worker" });
  return { ...state, ext, fixture, worker: await state.app.connect(target) };
}

async function reply(shell, name, args) {
  const result = await shell.call(name, args);
  if (!result.ok) throw new Error(`${name} failed: ${result.code} ${result.message}`);
  return result.value;
}

export const e97 = {
  id: "E97",
  issue: 97,
  title: "Extension search providers (chrome_settings_overrides) on Linux",
  deadline: 180000,
  manual: [
    { name: "The provider appears in Settings › Search", steps: ["Load the follow-up fixture unpacked.", "Settings › Search lists Ardia Fixture Search as an extension engine.", "Remove the extension: the engine disappears from Settings › Search."], reason: "Settings needs a desktop session to click through" },
  ],
  async run(t) {
    const { shell, ext } = await loaded(t, "search-provider");
    await t.check("the extension's search provider is listed by search.engines as a provider, not an omnibox keyword", async () => {
      const engine = await until(async () => (await reply(shell, "search.engines", {})).list.engines.find((e) => e.extension?.id === ext.id) ?? false,
        { timeout: 15000, label: "the provider in search.engines" });
      if (engine.isOmniboxExtension !== false || engine.keyword !== SEARCH_KEYWORD) throw new Error(JSON.stringify(engine));
      return { keyword: engine.keyword, name: engine.name };
    }, { critical: true });
    await t.check("Ardia maps the provider into its own extension search engines", async () => {
      const mapped = await until(async () => (await shell.state("return s.settings.extensionSearchEngines ?? [];")).find((e) => e.extensionId === ext.id) ?? false,
        { timeout: 15000, label: "the provider in Ardia's search engines" });
      return mapped;
    });
    await t.check("uninstalling the extension removes the provider everywhere", async () => {
      await reply(shell, "extensions.uninstall", { id: ext.id });
      await until(async () => !(await reply(shell, "search.engines", {})).list.engines.some((e) => e.extension?.id === ext.id), { timeout: 10000, label: "gone from search.engines" });
      await until(async () => !(await shell.state("return s.settings.extensionSearchEngines ?? [];")).some((e) => e.extensionId === ext.id), { timeout: 15000, label: "gone from Ardia's search engines" });
      return true;
    });
  },
};

export const e98 = {
  id: "E98",
  issue: 98,
  title: "Extension keyboard shortcuts reach Ardia's toolbar",
  deadline: 180000,
  manual: [
    { name: "_execute_action opens the popup under Ardia's toolbar button", steps: [`Load the follow-up fixture unpacked and pin it.`, `With a page focused, press ${ACTION_SHORTCUT}: the fixture's popup opens under its Ardia toolbar button for the focused tab.`, "Holding the keys does not reopen it repeatedly; pressing again after closing reopens it."], reason: "needs real keyboard input through the native window" },
    { name: "Named commands fire chrome.commands.onCommand", steps: [`Press ${COMMAND_SHORTCUT} with a page focused, then with the sidebar focused.`, "The fixture's service worker records fixture-command with the active tab each time (globalThis.commandReports)."], reason: "needs real keyboard input through the native window" },
    { name: "Extension shortcuts never shadow Ardia's", steps: [`In Settings › Keyboard Shortcuts, assign ${COMMAND_SHORTCUT} to an Ardia command (for example New Tab).`, `Press ${COMMAND_SHORTCUT}: Ardia's command runs and the fixture records nothing.`, "Reset the Ardia shortcut: the fixture command fires again."], reason: "needs real keyboard input and the Settings window" },
    { name: "Side panel through the action shortcut", steps: ["From the fixture's service worker run chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }) after adding a side_panel to a copy of the fixture.", `${ACTION_SHORTCUT} toggles the side panel instead of the popup. Chromium 156 has no _execute_side_panel command; that name is an ordinary named command.`], reason: "needs real keyboard input" },
  ],
  async run(t) {
    const { worker } = await loaded(t, "extension-shortcuts");
    await t.check("Chromium assigns the fixture's action and named shortcuts on Linux", async () => {
      const commands = await evaluate(worker, "chrome.commands.getAll()");
      const shortcut = (name) => commands.find((c) => c.name === name)?.shortcut ?? null;
      const action = shortcut("_execute_action");
      const named = shortcut("fixture-command");
      if (!action || !named) throw new Error(JSON.stringify(commands));
      return { action, named };
    });
  },
};

export const e100 = {
  id: "E100",
  issue: 100,
  title: "Native messaging hosts installed for Chrome and Chromium",
  deadline: 180000,
  manual: [
    { name: "A password manager's desktop app connects", steps: ["Install 1Password, Bitwarden or KeePassXC with browser integration for Chrome or Chromium.", "Install its extension from the Chrome Web Store in Ardia.", "The extension reports the desktop app as connected and fills a login."], reason: "automated in E100D with a fake desktop app; a real password manager and its Web Store extension need a person" },
  ],
  async run(t) {
    const { app, scratch, ext, worker } = await loaded(t, "native-messaging");
    const home = join(scratch, "home");
    const scripts = join(scratch, "native-hosts");
    const config = join(home, ".config");
    const folders = {
      chromium: join(config, "chromium", "NativeMessagingHosts"),
      chrome: join(config, "google-chrome", "NativeMessagingHosts"),
      ardia: join(scratch, "NativeMessagingHosts"),
    };
    const install = (location, name, ids = [ext.id]) => installEchoHost({ folder: folders[location], scripts, name, location, extensionIds: ids });
    const roundTrip = async (name, location) => {
      const result = await sendNative(worker, name, { ping: name });
      if (!result.ok || result.reply?.location !== location || result.reply?.echo?.ping !== name || result.reply?.origin !== `chrome-extension://${ext.id}/`) throw new Error(JSON.stringify(result));
      return result.reply;
    };

    await t.check("a host installed for Chromium (~/.config/chromium/NativeMessagingHosts) answers", async () => {
      await install("chromium", "dev.ardia.acceptance.chromium");
      return roundTrip("dev.ardia.acceptance.chromium", "chromium");
    }, { critical: true });
    await t.check("a host installed for Chrome (~/.config/google-chrome/NativeMessagingHosts) answers", async () => {
      await install("chrome", "dev.ardia.acceptance.chrome");
      return roundTrip("dev.ardia.acceptance.chrome", "chrome");
    });
    await t.check("Ardia's own NativeMessagingHosts folder wins over Chrome's and Chromium's", async () => {
      for (const location of ["chromium", "chrome", "ardia"]) await install(location, "dev.ardia.acceptance.shared");
      return roundTrip("dev.ardia.acceptance.shared", "ardia");
    });
    await t.check("a host that doesn't list the extension is refused, and an unknown host isn't found", async () => {
      await install("chromium", "dev.ardia.acceptance.other", ["a".repeat(32)]);
      const forbidden = await sendNative(worker, "dev.ardia.acceptance.other", { ping: 1 });
      const missing = await sendNative(worker, "dev.ardia.acceptance.missing", { ping: 1 });
      if (forbidden.ok || !/forbidden/i.test(forbidden.error) || missing.ok || !/not found/i.test(missing.error)) throw new Error(JSON.stringify({ forbidden, missing }));
      return { forbidden: forbidden.error, missing: missing.error };
    });
    await t.evidence("native-hosts", { folders, extension: ext.id, targets: (await app.targets()).length });
  },
};
