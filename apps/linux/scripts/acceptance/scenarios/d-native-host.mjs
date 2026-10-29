import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { clickLabelIn, clickTextIn, currentRect, desktopShot, desktopUnavailable, newWindow, openDesktop, pointAt, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { rowControl } from "../lib/desktopSettings.mjs";
import { sessionSeed, writeProfileSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";
import { FOLLOWUP_EXTENSION } from "./e-extension-followups.mjs";
import { fixtureSecret } from "../lib/fixtureSecrets.mjs";

const VAULT = new URL("../fixtures/password-manager/", import.meta.url);
const VAULT_NAME = "Ardia Fixture Vault";
const VAULT_DESCRIPTION = "Talks to its desktop app over native messaging and fills the login it returns.";
const FOLLOWUP_DESCRIPTION = "Declares a search provider, keyboard commands and native messaging.";
const HOST = "dev.ardia.acceptance.vault";
const APP = "Ardia Fixture Vault Desktop";
const LOGIN = { username: "vault-user", password: fixtureSecret("vault-") };

const HOST_SOURCE = `let buffer = Buffer.alloc(0);
const send = (value) => { const body = Buffer.from(JSON.stringify(value)); const head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0); process.stdout.write(Buffer.concat([head, body])); };
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (buffer.length < 4 + size) return;
    const message = JSON.parse(buffer.subarray(4, 4 + size).toString("utf8"));
    buffer = buffer.subarray(4 + size);
    if (message.command === "hello") send({ app: ${JSON.stringify(APP)}, caller: process.argv[2] ?? null });
    else if (message.command === "login") send(message.origin.startsWith("http://127.0.0.1:") ? ${JSON.stringify(LOGIN)} : {});
    else send({ error: "unknown command" });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

async function installDesktopApp(scratch, extensionId) {
  const folder = join(scratch, "home", ".config", "google-chrome", "NativeMessagingHosts");
  await mkdir(folder, { recursive: true });
  const script = join(scratch, "vault-desktop.mjs");
  const launcher = join(scratch, "vault-desktop.sh");
  await writeFile(script, HOST_SOURCE);
  await writeFile(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`);
  await chmod(launcher, 0o755);
  const manifest = join(folder, `${HOST}.json`);
  await writeFile(manifest, JSON.stringify({ name: HOST, description: "Ardia acceptance password manager desktop app", path: launcher, type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2));
  return manifest;
}

async function pinBoth(desktop, app, shell) {
  const browser = await until(async () => (await desktop.windows()).find((w) => / - Ardia$/.test(w.title)) ?? false, { timeout: 15000, label: "the browser window" });
  await delay(1500);
  const pinned = await shell.labels();
  if (pinned.includes(VAULT_NAME) && pinned.includes("Follow-up Action")) return browser;
  const known = await desktop.windows();
  await clickLabelIn(desktop, browser, shell, "Settings");
  const settings = await app.shell("settings", { timeout: 20000 });
  const window = await newWindow(desktop, known, { label: "the Settings window" });
  await clickTextIn(desktop, window, settings, "Extensions");
  for (const [description, label] of [[VAULT_DESCRIPTION, VAULT_NAME], [FOLLOWUP_DESCRIPTION, "Follow-up Action"]]) {
    if (pinned.includes(label)) continue;
    await clickTextIn(desktop, window, settings, description);
    await pointAt(desktop, window, await until(() => rowControl(settings, "Pin to toolbar"), { timeout: 8000, label: "Pin to toolbar" }));
    await delay(600);
    await clickTextIn(desktop, window, settings, "All Extensions");
    await delay(400);
  }
  await clickLabelIn(desktop, window, settings, "Close window");
  await until(async () => (await desktop.windows()).length === known.length, { timeout: 8000, label: "Settings to close" });
  return browser;
}

async function openPopup(t, desktop, app, shell, browser) {
  const button = await until(() => shell.eval(`(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].find((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === ${JSON.stringify(VAULT_NAME)} && n.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: innerWidth - r.right, edge: r.right, bottom: r.bottom }; })()`), { timeout: 8000, label: "the pinned Vault button" });
  if (button.right < 40) throw new Error(`the Vault button sits in the window's corner (${button.right}px from the edge), where #253's invisible caption buttons take the click`);
  const popup = async () => (await app.targets()).find((x) => x.type === "page" && x.url.endsWith("/popup.html")) ?? false;
  let target = false;
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    const frame = await currentRect(desktop, browser);
    await desktop.pointerMove(frame.x + button.x - 40, frame.y + button.y);
    await delay(500);
    await pointAt(desktop, browser, button);
    target = await until(popup, { timeout: 6000, label: "the Vault popup" }).catch(() => false);
  }
  if (!target) {
    await desktopShot(t, desktop, "popup-missing");
    throw new Error(`no popup after two clicks on the Vault button at ${JSON.stringify(button)}`);
  }
  const session = await app.connect(target);
  return { session, button, status: await until(async () => { const text = await evaluate(session, "document.getElementById('status').textContent"); return /Connecting/.test(text) ? false : text; }, { timeout: 10000, label: "the popup's connection status" }) };
}

async function launch(t, desktop, scratch, label) {
  const vault = join(scratch, "vault-extension");
  const followup = join(scratch, "followup-extension");
  const { app, shell } = await startDesktopBrowser(t, desktop, { scratch, label, extensions: true, extraArgs: [`--load-extension=${vault},${followup}`] });
  const ext = await until(async () => { const reply = await shell.call("extensions.list", {}); return (reply.ok ? reply.value.extensions ?? [] : []).find((x) => x.name === VAULT_NAME) ?? false; }, { timeout: 20000, label: "the Vault fixture in extensions.list" });
  const browser = await pinBoth(desktop, app, shell);
  return { app, shell, ext, browser };
}

export default {
  id: "E100D",
  issue: 100,
  desktop: true,
  title: "A password manager extension reaches its desktop app through a native messaging host installed for Chrome (~/.config/google-chrome): the popup opened from Ardia's toolbar says connected and fills a login",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("A password manager's desktop app connects", ["Install a password manager with browser integration for Chrome and its extension in Ardia: the extension says connected and fills a login."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const scratch = await t.scratch("vault");
    await cp(VAULT, join(scratch, "vault-extension"), { recursive: true });
    await cp(FOLLOWUP_EXTENSION, join(scratch, "followup-extension"), { recursive: true });
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      response.end('<!doctype html><title>Login fixture</title><form><input name="username" type="text" id="username"><input type="password" id="password"><button>Sign in</button></form>');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.defer(() => new Promise((resolve) => server.close(resolve)));
    const loginUrl = `http://127.0.0.1:${server.address().port}/login`;
    await writeProfileSeed(scratch, { session: sessionSeed({ windows: [{ id: "main", urls: [loginUrl] }] }) });
    let ext;
    await t.check("without the desktop app, the popup opened from Ardia's toolbar says the host isn't found", async () => {
      const first = await launch(t, desktop, scratch, "no-app");
      ext = first.ext;
      try {
        const { status } = await openPopup(t, desktop, first.app, first.shell, first.browser);
        await desktopShot(t, desktop, "popup-no-app");
        if (!/not connected: .*not found/i.test(status)) throw new Error(`the popup says ${JSON.stringify(status)}`);
        return { status };
      } finally {
        await t.stop(first.app);
      }
    });
    const manifest = await installDesktopApp(scratch, ext.id);
    await t.check("with the desktop app's host in ~/.config/google-chrome/NativeMessagingHosts, the popup says connected and Fill Login fills the page", async () => {
      const second = await launch(t, desktop, scratch, "with-app");
      try {
        const { session, status, button } = await openPopup(t, desktop, second.app, second.shell, second.browser);
        if (status !== `Connected to ${APP}`) throw new Error(`the popup says ${JSON.stringify(status)}`);
        const fill = await evaluate(session, "(() => { const r = document.getElementById('fill').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: innerWidth }; })()");
        const filled = () => evaluate(session, "document.getElementById('result').textContent").then((text) => /Filled/.test(text));
        for (const gap of [7, 3, 11, 15]) {
          if (await filled()) break;
          await pointAt(desktop, second.browser, { x: button.edge - fill.width + fill.x, y: button.bottom + gap + fill.y });
          await until(filled, { timeout: 2500, label: "the fill" }).catch(() => false);
        }
        await until(async () => /Filled vault-user/.test(await evaluate(session, "document.getElementById('result').textContent")), { timeout: 10000, label: "the popup to report the fill" });
        await desktopShot(t, desktop, "popup-filled");
        const page = await second.app.pageSession((x) => x.url.startsWith(loginUrl));
        const values = await evaluate(page, "[document.getElementById('username').value, document.getElementById('password').value]");
        if (values[0] !== LOGIN.username || values[1] !== LOGIN.password) throw new Error(`the page has ${JSON.stringify(values)}`);
        return { status, manifest: manifest.split("/home/")[1], filled: values[0] };
      } finally {
        await t.stop(second.app);
      }
    });
  },
};
