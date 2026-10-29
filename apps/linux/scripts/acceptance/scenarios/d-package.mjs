import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateEnvironment, stopGroup, trackGroup } from "../lib/desktop.mjs";

const ACTION = "dev.ardia.linux.reauthenticate";
const POLICY = "usr/share/polkit-1/actions/dev.ardia.linux.policy";
const PKGBUILD = fileURLToPath(new URL("../../../../../scripts/linux/arch/PKGBUILD", import.meta.url));
export const POLKITD = "/usr/lib/polkit-1/polkitd";
const MAKEPKG_MS = 300000;
const POLKIT_MS = 45000;
const LISTING_MS = 30000;

const exists = (path) => access(path).then(() => true, () => false);

export async function runTracked(command, args, { env, cwd, timeout, log, defer }) {
  const out = log ? openSync(log, "a") : null;
  const child = spawn(command, args, { env, cwd, detached: true, stdio: ["ignore", out ?? "pipe", out ?? "pipe"] });
  if (out !== null) closeSync(out);
  const state = { exited: false, code: null };
  const proc = trackGroup({ child, state });
  defer?.(() => stopGroup(proc));
  let stdout = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stdout += chunk; });
  const exited = new Promise((done) => {
    child.once("exit", (code, signal) => { state.exited = true; state.code = code ?? signal; done(); });
    child.once("error", (error) => { state.exited = true; state.code = error.message; done(); });
  });
  let timer;
  const timedOut = await Promise.race([exited.then(() => false), new Promise((done) => { timer = setTimeout(() => done(true), timeout); })]);
  clearTimeout(timer);
  await stopGroup(proc);
  return { code: state.code, timedOut, stdout, pid: child.pid };
}

async function which(name) {
  const env = privateEnvironment();
  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) if (await exists(join(dir, name))) return join(dir, name);
  return null;
}

async function packageRoot(executable) {
  for (const candidate of [resolve(dirname(executable), ".."), resolve(dirname(executable), "../..")]) {
    if (await exists(join(candidate, "install.sh"))) return candidate;
  }
  return null;
}

export async function subordinateIds() {
  const uid = String(process.getuid());
  const name = (await readFile("/etc/passwd", "utf8")).split("\n").find((l) => l.split(":")[2] === uid)?.split(":")[0];
  const line = async (file) => (await readFile(file, "utf8").catch(() => "")).split("\n").find((l) => l.startsWith(`${name}:`) || l.startsWith(`${uid}:`));
  const users = await line("/etc/subuid");
  const groups = await line("/etc/subgid");
  if (!users || !groups) return null;
  const [, uStart, uCount] = users.split(":");
  const [, gStart, gCount] = groups.split(":");
  return { users: `1:${uStart}:${Math.min(Number(uCount), 65535)}`, groups: `1:${gStart}:${Math.min(Number(gCount), 65535)}` };
}

export function polkitBusConfig(socket, services) {
  return `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=${socket}</listen>
  <auth>EXTERNAL</auth>
  <servicedir>${services}</servicedir>
  <policy context="default">
    <allow user="*"/>
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`;
}

export function privatePolkitScript(dir, { hold = 0 } = {}) {
  return `mount --bind '${dir}/actions' /usr/share/polkit-1/actions || exit 3
dbus-daemon --nofork --nopidfile --config-file='${dir}/bus.conf' > '${dir}/bus.log' 2>&1 < /dev/null &
sleep 0.5
export DBUS_SYSTEM_BUS_ADDRESS='unix:path=${dir}/system-bus'
${POLKITD} --no-debug > '${dir}/polkitd.log' 2>&1 < /dev/null &
status=1
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  sleep 0.3
  if pkaction --action-id ${ACTION} --verbose > '${dir}/pkaction.out' 2>&1; then status=0; break; fi
done
sleep ${hold}
exit $status
`;
}

export async function runPrivatePolkit(dir, policy, { ids, unshare = "unshare", timeout = POLKIT_MS, hold = 0, defer } = {}) {
  await chmod(dir, 0o755);
  await mkdir(join(dir, "actions"), { recursive: true });
  await mkdir(join(dir, "services"), { recursive: true });
  await copyFile(policy, join(dir, "actions", "dev.ardia.linux.policy"));
  await chmod(join(dir, "actions"), 0o755);
  await chmod(join(dir, "actions", "dev.ardia.linux.policy"), 0o644);
  await writeFile(join(dir, "bus.conf"), polkitBusConfig(join(dir, "system-bus"), join(dir, "services")));
  await writeFile(join(dir, "inner.sh"), privatePolkitScript(dir, { hold }));
  const env = privateEnvironment(process.env, { HOME: dir });
  const run = await runTracked(unshare, ["--map-root-user", `--map-users=${ids.users}`, `--map-groups=${ids.groups}`, "--setgroups", "allow", "--mount", "--pid", "--fork", "--kill-child", "sh", join(dir, "inner.sh")], { env, timeout, defer });
  return { ...run, out: await readFile(join(dir, "pkaction.out"), "utf8").catch(() => ""), log: await readFile(join(dir, "polkitd.log"), "utf8").catch(() => "") };
}

async function makepkgConfig(build) {
  const system = await readFile("/etc/makepkg.conf", "utf8");
  const file = join(build, "makepkg.conf");
  await writeFile(file, `${system}\nBUILDENV=(!distcc !color !ccache !check !sign)\nGPGKEY=""\nPACKAGER="Ardia acceptance <acceptance@ardia.invalid>"\n`);
  return file;
}

export default {
  id: "S105P",
  issue: 105,
  desktop: true,
  title: "The Arch package built with makepkg into a scratch folder (no install, no signing, its own config and HOME) ships the polkit action where polkit reads it, and a private polkitd started without root reads it from the package",
  deadline: 480000,
  async run(t) {
    const tools = { makepkg: await which("makepkg"), fakeroot: await which("fakeroot"), bsdtar: await which("bsdtar"), unshare: await which("unshare"), pkaction: await which("pkaction"), dbusDaemon: await which("dbus-daemon"), polkitd: (await exists(POLKITD)) ? POLKITD : null };
    const root = await packageRoot(t.options.executable);
    const missing = Object.entries(tools).filter(([, path]) => !path).map(([name]) => name);
    if (missing.length || !root) {
      t.manual("The installed package registers the action", ["Build scripts/linux/arch/PKGBUILD with makepkg and install it; pkaction lists the action with implicit active auth_self."], missing.length ? `${missing.join(", ")} not found` : `no install.sh beside ${t.options.executable}`);
      return;
    }
    const build = await t.scratch("makepkg");
    const home = join(build, "home");
    await mkdir(home, { recursive: true });
    const env = privateEnvironment(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share"), GNUPGHOME: join(home, ".gnupg"), BUILDDIR: build, SRCDEST: build, PKGDEST: join(build, "out"), PKGEXT: ".pkg.tar", MAKEFLAGS: "", PACKAGER: "Ardia acceptance <acceptance@ardia.invalid>" });
    for (const key of ["GPGKEY", "GPG_TTY", "GPG_AGENT_INFO", "SSH_AGENT_PID"]) delete env[key];
    const defer = (stop) => t.defer(stop);
    const archive = join(build, "out", "ardia-bin-0.0.0-1-x86_64.pkg.tar");
    let pkgdir;
    await t.check("makepkg builds ardia-bin from scripts/linux/arch/PKGBUILD into a scratch folder, unsigned, with its own config and HOME", async () => {
      await copyFile(PKGBUILD, join(build, "PKGBUILD"));
      await mkdir(join(build, "src"), { recursive: true });
      await symlink(root, join(build, "src", "ardia"));
      const config = await makepkgConfig(build);
      const log = join(build, "makepkg.log");
      const result = await runTracked(tools.makepkg, ["--config", config, "--noextract", "--nodeps", "--force", "--noconfirm", "--skipinteg", "--nosign"], { cwd: build, env, timeout: MAKEPKG_MS, log, defer });
      const output = await readFile(log, "utf8").catch(() => "");
      await t.evidence("makepkg", { code: result.code, timedOut: result.timedOut, log: output.split("\n").slice(-40) });
      if (result.timedOut) throw new Error(`makepkg ran past ${MAKEPKG_MS / 1000} s and was stopped`);
      if (result.code !== 0 || !(await exists(archive))) throw new Error(`makepkg exited ${result.code}: ${output.slice(-400)}`);
      if (await exists(`${archive}.sig`)) throw new Error("the package was signed");
      pkgdir = join(build, "pkg", "ardia-bin");
      return { finished: /Finished making/.test(output), signed: false };
    }, { timeout: MAKEPKG_MS + 20000, critical: true });
    await t.check("the package ships the policy at /usr/share/polkit-1/actions, 0644 root:root, byte for byte the source's, with a /usr launcher and a polkit dependency", async () => {
      const listing = (await runTracked(tools.bsdtar, ["-tvf", archive], { env, timeout: LISTING_MS, defer })).stdout.split("\n");
      const policyRow = listing.find((l) => l.endsWith(` ${POLICY}`));
      if (!policyRow || !/^-rw-r--r--\s+0 root\s+root\s/.test(policyRow)) throw new Error(`policy row ${JSON.stringify(policyRow)}`);
      const stray = listing.filter((l) => / usr\/share\/polkit-1\/./.test(l) && !/ usr\/share\/polkit-1\/actions\/(dev\.ardia\.linux\.policy)?$/.test(l));
      if (stray.length) throw new Error(`other polkit files: ${stray.join("; ")}`);
      const packaged = await readFile(join(pkgdir, POLICY), "utf8");
      const source = await readFile(join(root, "share/polkit-1/actions/dev.ardia.linux.policy"), "utf8");
      if (packaged !== source || !packaged.includes(`<action id="${ACTION}">`)) throw new Error("the packaged policy differs from the source");
      const launcher = await readFile(join(pkgdir, "usr/bin/ardia"), "utf8");
      if (!launcher.includes("/usr/lib/ardia/chrome")) throw new Error(`launcher ${launcher}`);
      const info = (await runTracked(tools.bsdtar, ["-xOf", archive, ".PKGINFO"], { env, timeout: LISTING_MS, defer })).stdout;
      if (!/^depend = polkit$/m.test(info)) throw new Error("no polkit dependency in .PKGINFO");
      await t.evidence("package-listing", { policy: policyRow, files: listing.length });
      return { policy: policyRow.replace(/\s+/g, " "), files: listing.length };
    }, { timeout: LISTING_MS * 2 + 10000 });
    await t.check("a private polkitd in a user and PID namespace, with the package's actions folder mounted over /usr/share/polkit-1/actions, lists the action with implicit active auth_self", async () => {
      const ids = await subordinateIds();
      if (!ids) throw new Error("no /etc/subuid and /etc/subgid range for this user, which polkitd needs to drop to its own user without root");
      const result = await runPrivatePolkit(await t.tempDir("polkit"), join(pkgdir, POLICY), { ids, unshare: tools.unshare, defer });
      await t.evidence("pkaction", { out: result.out, code: result.code, timedOut: result.timedOut });
      if (result.timedOut || result.code !== 0) throw new Error(`the namespace exited ${result.code}${result.timedOut ? " after its deadline" : ""}; polkitd: ${result.log.slice(-300)}; pkaction: ${result.out.slice(-300)}`);
      const out = result.out;
      if (!out.startsWith(`${ACTION}:`) || !/implicit active:\s*auth_self\b/.test(out) || !/implicit any:\s*no\b/.test(out) || !/implicit inactive:\s*no\b/.test(out)) throw new Error(out);
      return { implicit: out.split("\n").filter((l) => l.includes("implicit")).map((l) => l.trim()) };
    }, { timeout: POLKIT_MS + 10000 });
  },
};
