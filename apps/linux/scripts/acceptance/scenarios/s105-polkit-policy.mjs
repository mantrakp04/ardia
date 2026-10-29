import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { startBrowser } from "../lib/flows.mjs";

const run = promisify(execFile);
const ACTION = "dev.ardia.linux.reauthenticate";
const SYSTEM_POLICY = "/usr/share/polkit-1/actions/dev.ardia.linux.policy";

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function packageRoot(executable) {
  for (const candidate of [resolve(dirname(executable), ".."), resolve(dirname(executable), "../..")]) {
    if (await exists(join(candidate, "install.sh"))) return candidate;
  }
  return null;
}

export default {
  id: "S105",
  issue: 105,
  title: "Packages install the polkit policy where polkit reads it, and its absence fails closed",
  deadline: 180000,
  manual: [
    { name: "The installed package registers the action", steps: ["Install Ardia from its package (scripts/linux/arch/PKGBUILD with makepkg -si, or sudo ./install.sh from the extracted tarball).", `pkaction --action-id ${ACTION} --verbose lists the action with implicit active auth_self and implicit any/inactive no.`, "The F07 manual prompt checks pass with the desktop's polkit agent."], reason: "automated in S105P with makepkg and a private polkitd; a root install with the desktop's agent needs a person" },
  ],
  async run(t) {
    await t.check("the package's installer puts the policy under DESTDIR/usr/share/polkit-1/actions for any prefix", async () => {
      const root = await packageRoot(t.options.executable);
      if (!root) throw new Error(`no install.sh beside ${t.options.executable}; run the suite against an extracted package`);
      const results = {};
      for (const prefix of ["/usr", "/opt/ardia"]) {
        const destdir = await t.scratch(`install${prefix.replaceAll("/", "-")}`);
        await run(join(root, "install.sh"), ["--prefix", prefix, "--destdir", destdir], { timeout: 120000 });
        const policy = join(destdir, "usr/share/polkit-1/actions/dev.ardia.linux.policy");
        const text = await readFile(policy, "utf8");
        const mode = (await stat(policy)).mode & 0o777;
        if (!text.includes(`<action id="${ACTION}">`) || mode !== 0o644) throw new Error(`${prefix}: mode ${mode.toString(8)}`);
        const launcher = await readFile(join(destdir, prefix.slice(1), "bin/ardia"), "utf8");
        if (!launcher.includes(`${prefix}/lib/ardia/chrome`)) throw new Error(`${prefix}: launcher ${launcher}`);
        results[prefix] = { mode: mode.toString(8) };
      }
      return results;
    });

    const installed = await exists(SYSTEM_POLICY);
    if (installed) {
      await t.check("pkaction lists the installed action", async () => {
        const { stdout } = await run("pkaction", ["--action-id", ACTION, "--verbose"], { timeout: 30000 });
        if (!stdout.includes(ACTION) || !/implicit active:\s*auth_self\b/.test(stdout)) throw new Error(stdout);
        return { stdout };
      });
    }

    const { shell } = await startBrowser(t, { name: "polkit", background: false });
    await t.check(installed ? "status reports the installed policy" : "status names the missing policy and where it belongs", async () => {
      const reply = await shell.invoke("ArdiaPasswords.status", { args: [""] });
      if (!reply.ok) throw new Error(`${reply.code} ${reply.message}`);
      const value = reply.value;
      if (installed) {
        if (value.reauthReason === "policyMissing") throw new Error(JSON.stringify(value));
      } else if (value.reauthReason === "policyMissing") {
        if (value.reauth !== false || !value.reauthMessage?.includes("/usr/share/polkit-1/actions")) throw new Error(JSON.stringify(value));
      } else if (value.reauth !== false || !["noPolkit", "unavailable", "notPermitted"].includes(value.reauthReason)) {
        throw new Error(JSON.stringify(value));
      }
      return { reauth: value.reauth, reauthReason: value.reauthReason, installed };
    });
  },
};
