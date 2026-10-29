import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { busCall, nameOwned } from "./desktopServices.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { until } from "./util.mjs";
import { fixtureSecret } from "./fixtureSecrets.mjs";

export const KEYRING_PASSWORD = fixtureSecret("keyring-");
const LOGIN = "/org/freedesktop/secrets/collection/login";
const SECRET_ITEMS = fileURLToPath(new URL("./tools/secret_items.py", import.meta.url));

export async function secretItems(desktop, op, payload = {}) {
  const out = await desktop.run("python3", ["-I", SECRET_ITEMS, desktop.session.address, op, JSON.stringify(payload)], { env: { PYTHONDONTWRITEBYTECODE: "1" }, timeout: 40000 });
  return JSON.parse(out.trim() || "null");
}

export const PROMPTER = "/usr/lib/gcr-prompter";
const PROMPTER_NAMES = ["org.gnome.keyring.SystemPrompter", "org.gnome.keyring.PrivatePrompter"];
const DBUS = { dest: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", iface: "org.freedesktop.DBus" };

export const prompterMissing = async () => (await access(PROMPTER, constants.X_OK).then(() => false, () => true)) ? `${PROMPTER} not found (gcr 3 provides gnome-keyring's unlock prompt)` : null;

export function prompterService(name, exec = PROMPTER) {
  return `[D-BUS Service]\nName=${name}\nExec=${exec}\n`;
}

export async function enablePrompter(desktop, { exec = PROMPTER } = {}) {
  for (const name of PROMPTER_NAMES) await writeFile(join(desktop.session.serviceDir, `${name}.service`), prompterService(name, exec));
  const environment = { XDG_RUNTIME_DIR: desktop.env.XDG_RUNTIME_DIR, GDK_BACKEND: desktop.kind === "x11" ? "x11" : "wayland", HOME: desktop.home, ...(desktop.env.WAYLAND_DISPLAY ? { WAYLAND_DISPLAY: desktop.env.WAYLAND_DISPLAY } : {}), ...(desktop.env.DISPLAY ? { DISPLAY: desktop.env.DISPLAY } : {}) };
  await busCall(desktop, { ...DBUS, method: "UpdateActivationEnvironment", args: [environment], signature: "a{ss}" });
  await busCall(desktop, { ...DBUS, method: "ReloadConfig", args: [], signature: "" });
  return PROMPTER_NAMES;
}

export async function prompterWindow(desktop, { timeout = 15000 } = {}) {
  return until(async () => (await desktop.windows()).find((w) => /gcr-prompter|Unlock|Keyring|keyring/i.test(`${w.appId ?? ""} ${w.title ?? ""}`)) ?? false, { timeout, label: "gnome-keyring's unlock prompt (gcr-prompter)" });
}

export async function answerPrompter(desktop, window, { allow, password = KEYRING_PASSWORD, attempts = 3 } = {}) {
  const gone = async () => !(await desktop.windows()).some((w) => w.id === window.id);
  for (let attempt = 0; attempt < attempts && !(await gone()); attempt++) {
    await desktop.raise(window).catch(() => {});
    await until(async () => (await desktop.focused())?.id === window.id, { timeout: 5000, label: "the unlock prompt focused" }).catch(() => {});
    const frame = (await desktop.windows()).find((w) => w.id === window.id)?.rect ?? window.rect;
    await desktop.click(frame.x + frame.width * 0.62, frame.y + Math.round(frame.height * 0.58));
    await delay(300);
    if (allow) {
      await desktop.key("ctrl+a");
      await desktop.type(password);
      await delay(200);
      await desktop.key("return");
    } else await desktop.key("escape");
    await until(gone, { timeout: 6000, label: "the unlock prompt to close" }).catch(() => {});
  }
  if (!(await gone())) throw new Error(`the unlock prompt is still open after ${attempts} ${allow ? "password" : "cancel"} attempts`);
}

export async function startKeyring(desktop, { state = "unlocked", items = [] } = {}) {
  await mkdir(join(desktop.home, ".local", "share", "keyrings"), { recursive: true });
  const proc = desktop.spawn(desktop.tools.keyring, ["--foreground", "--components=secrets", "--unlock"], { name: "gnome-keyring", stdio: ["pipe", "ignore", "ignore"], env: { GNOME_KEYRING_CONTROL: undefined } });
  proc.child.stdin.end(KEYRING_PASSWORD);
  await until(() => nameOwned(desktop, "org.freedesktop.secrets"), { timeout: 15000, interval: 200, label: "gnome-keyring-daemon on the private session bus", abort: () => (proc.state.exited ? `gnome-keyring-daemon exited (${proc.state.code})` : null) });
  const service = (method, args, signature) => busCall(desktop, { dest: "org.freedesktop.secrets", path: "/org/freedesktop/secrets", iface: "org.freedesktop.Secret.Service", method, args, signature });
  const locked = async () => busCall(desktop, { dest: "org.freedesktop.secrets", path: LOGIN, iface: "org.freedesktop.DBus.Properties", method: "Get", args: ["org.freedesktop.Secret.Collection", "Locked"], signature: "ss" });
  await until(async () => (await locked().catch(() => null)) === false, { timeout: 10000, label: "the login keyring to be created and unlocked" });
  for (const item of items) await secretItems(desktop, "create", item);
  if (state === "locked") {
    await service("Lock", [[LOGIN]], "ao");
    await until(async () => (await locked()) === true, { timeout: 10000, label: "the login keyring to lock" });
  }
  return {
    state,
    proc,
    locked,
    async lock() {
      await service("Lock", [[LOGIN]], "ao");
    },
    search: (attributes = {}, { secrets = false } = {}) => secretItems(desktop, "items", { attributes, secrets }),
    create: (item) => secretItems(desktop, "create", item),
    async unlock() {
      await secretItems(desktop, "unlock", { password: KEYRING_PASSWORD });
      await until(async () => (await locked()) === false, { timeout: 10000, label: "the login keyring to unlock" });
    },
    async items() {
      return busCall(desktop, { dest: "org.freedesktop.secrets", path: LOGIN, iface: "org.freedesktop.DBus.Properties", method: "Get", args: ["org.freedesktop.Secret.Collection", "Items"], signature: "ss" });
    },
    async stop() {
      try { process.kill(-proc.child.pid, "SIGTERM"); } catch {}
      await until(() => proc.state.exited, { timeout: 5000, label: "gnome-keyring-daemon to stop" }).catch(() => {});
    },
  };
}
