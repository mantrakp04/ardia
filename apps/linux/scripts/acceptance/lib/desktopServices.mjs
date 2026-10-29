import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pythonSitePackages } from "./desktop.mjs";
import { until } from "./util.mjs";

const MOCK_DIR = new URL("./mocks/", import.meta.url);
export const MOCK_TEMPLATE = (name) => fileURLToPath(new URL(`${name}.py`, MOCK_DIR));
const BUS_CALL = fileURLToPath(new URL("bus_call.py", MOCK_DIR));
const MOCK_IFACE = "org.freedesktop.DBus.Mock";

async function pythonEnv(desktop) {
  const site = await pythonSitePackages(desktop.env);
  return site ? { PYTHONPATH: [site, desktop.env.PYTHONPATH].filter(Boolean).join(delimiter), PYTHONDONTWRITEBYTECODE: "1" } : { PYTHONDONTWRITEBYTECODE: "1" };
}

export async function busCall(desktop, { system = false, dest, path, iface, method, args = [], signature }) {
  const address = system ? desktop.system.address : desktop.session.address;
  const out = await desktop.run("python3", [BUS_CALL, address, dest, path, iface, method, JSON.stringify(args), ...(signature === undefined ? [] : [signature])], { env: await pythonEnv(desktop), timeout: 40000 });
  return JSON.parse(out.trim() || "null");
}

export async function nameOwned(desktop, name, { system = false } = {}) {
  return busCall(desktop, { system, dest: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", iface: "org.freedesktop.DBus", method: "NameHasOwner", args: [name], signature: "s" }).catch(() => false);
}

export async function startMock(desktop, { template, name, path, parameters = {}, system = false, label }) {
  const env = await pythonEnv(desktop);
  const tag = label ?? template.split("/").pop().replace(/\.py$/, "");
  const proc = desktop.spawn("python3", ["-m", "dbusmock", ...(system ? ["--system"] : ["--session"]), "--template", template, "--parameters", JSON.stringify(parameters)], { name: `mock-${tag}`, env });
  await until(() => nameOwned(desktop, name, { system }), { timeout: 15000, interval: 200, label: `the ${tag} mock on the private ${system ? "system" : "session"} bus`, abort: () => (proc.state.exited ? `the ${tag} mock exited (${proc.state.code})` : null) });
  const mock = {
    name,
    path,
    proc,
    system,
    call: (method, args = [], { iface = MOCK_IFACE, objectPath = path, signature } = {}) => busCall(desktop, { system, dest: name, path: objectPath, iface, method, args, signature }),
    async calls() {
      return JSON.parse(await mock.call("Calls", [], { signature: "" }));
    },
    async stop() {
      try { process.kill(-proc.child.pid, "SIGTERM"); } catch {}
      await until(() => proc.state.exited, { timeout: 5000, label: `${tag} to stop` }).catch(() => {});
      await until(async () => !(await nameOwned(desktop, name, { system })), { timeout: 5000, label: `${name} to leave the bus` }).catch(() => {});
    },
  };
  return mock;
}

export function startPolkit(desktop, { mode = "allow", registered } = {}) {
  return startMock(desktop, { template: MOCK_TEMPLATE("ardia_polkitd"), name: "org.freedesktop.PolicyKit1", path: "/org/freedesktop/PolicyKit1/Authority", system: true, parameters: { mode, ...(registered ? { registered } : {}) }, label: "polkitd" });
}

export function startFileManager(desktop, { fail = false } = {}) {
  return startMock(desktop, { template: MOCK_TEMPLATE("file_manager"), name: "org.freedesktop.FileManager1", path: "/org/freedesktop/FileManager1", parameters: { fail }, label: "file-manager" });
}

export function startUPower(desktop, { onBattery = false } = {}) {
  return startMock(desktop, { template: "upower", name: "org.freedesktop.UPower", path: "/org/freedesktop/UPower", system: true, parameters: { OnBattery: onBattery, DaemonVersion: "1.90.4" }, label: "upower" });
}

export function startPowerProfiles(desktop) {
  return startMock(desktop, { template: "power_profiles_daemon", name: "net.hadess.PowerProfiles", path: "/net/hadess/PowerProfiles", system: true, label: "power-profiles" });
}

export const PORTAL_BACKEND = "org.freedesktop.impl.portal.desktop.ardiaacceptance";

export async function startPortal(desktop, { fallback = { response: 1 }, interfaces = ["org.freedesktop.impl.portal.FileChooser"] } = {}) {
  const backend = await startMock(desktop, { template: MOCK_TEMPLATE("portal_backend"), name: PORTAL_BACKEND, path: "/org/freedesktop/portal/desktop", parameters: { default: fallback }, label: "portal-backend" });
  const data = join(desktop.dir, "portal-data");
  const config = join(desktop.dir, "portal-config");
  await mkdir(join(data, "xdg-desktop-portal", "portals"), { recursive: true });
  await mkdir(join(config, "xdg-desktop-portal"), { recursive: true });
  await writeFile(join(data, "xdg-desktop-portal", "portals", "ardiaacceptance.portal"), `[portal]\nDBusName=${PORTAL_BACKEND}\nInterfaces=${interfaces.join(";")};\nUseIn=ardia-acceptance\n`);
  await writeFile(join(config, "xdg-desktop-portal", "portals.conf"), "[preferred]\ndefault=ardiaacceptance\n");
  await writeFile(join(config, "xdg-desktop-portal", "ardia-acceptance-portals.conf"), "[preferred]\ndefault=ardiaacceptance\n");
  await writeFile(join(data, "xdg-desktop-portal", "portals", "ardia-acceptance-portals.conf"), "[preferred]\ndefault=ardiaacceptance\n");
  const proc = desktop.spawn(desktop.tools.portal, ["--replace", "--verbose"], { name: "xdg-desktop-portal", env: { XDG_DATA_DIRS: data, XDG_CONFIG_HOME: config, XDG_DESKTOP_PORTAL_DIR: join(data, "xdg-desktop-portal", "portals"), XDG_CURRENT_DESKTOP: "ardia-acceptance", GSETTINGS_SCHEMA_DIR: "/usr/share/glib-2.0/schemas", GSETTINGS_BACKEND: "memory" } });
  await until(() => nameOwned(desktop, "org.freedesktop.portal.Desktop"), { timeout: 20000, interval: 200, label: "xdg-desktop-portal on the private session bus", abort: () => (proc.state.exited ? `xdg-desktop-portal exited (${proc.state.code}); log ${join(desktop.dir, "xdg-desktop-portal.log")}` : null) });
  const version = await busCall(desktop, { dest: "org.freedesktop.portal.Desktop", path: "/org/freedesktop/portal/desktop", iface: "org.freedesktop.DBus.Properties", method: "Get", args: ["org.freedesktop.portal.FileChooser", "version"], signature: "ss" }).catch((error) => { throw new Error(`the private portal has no FileChooser: ${error.message}`); });
  return {
    backend,
    version,
    answer: (method, answer) => backend.call("Answer", [method, JSON.stringify(answer)], { signature: "ss" }),
    pick: (method, paths, { delay = 0, filter } = {}) => backend.call("Answer", [method, JSON.stringify({ response: 0, uris: paths.map((p) => pathToFileURL(p).href), delay, ...(filter ? { filter } : {}) })], { signature: "ss" }),
    cancel: (method, { delay = 0 } = {}) => backend.call("Answer", [method, JSON.stringify({ response: 1, delay })], { signature: "ss" }),
    calls: () => backend.calls(),
  };
}
