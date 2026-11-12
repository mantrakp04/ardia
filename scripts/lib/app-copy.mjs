import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const INJECTION_ENTITLEMENTS = ["com.apple.security.cs.allow-dyld-environment-variables", "com.apple.security.cs.disable-library-validation"];

export const signingIdentity = (app) => spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr.match(/^Authority=(.+)$/m)?.[1] ?? "-";

export function prepareApp(app, dir, { bundle = null, entitlements: extra = [] } = {}) {
  const installed = (path) => path.startsWith("/Applications/");
  if (installed(resolve(app))) throw new Error(`${app} is installed in /Applications: pass a build or a copy`);
  const source = realpathSync(resolve(app));
  if (installed(source)) throw new Error(`${app} is installed in /Applications: pass a build or a copy`);
  const copy = join(dir, "Ardia.app");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("cp", ["-cR", source, copy]);
  const shipped = join(copy, "Contents/Resources/main.jsbundle");
  const swapped = !!bundle && !(existsSync(shipped) && readFileSync(bundle).equals(readFileSync(shipped)));
  if (swapped) cpSync(bundle, shipped);
  const granted = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", source], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const missing = extra.filter((key) => !granted.includes(`<key>${key}</key>`));
  if (!swapped && !missing.length) return copy;
  const plist = join(dir, "entitlements.plist");
  writeFileSync(plist, granted.replace(/<\/dict>\s*<\/plist>\s*$/, `${missing.map((key) => `<key>${key}</key><true/>`).join("")}</dict></plist>`));
  execFileSync("codesign", ["--force", "--sign", signingIdentity(source), "--timestamp=none", "--options", "runtime", "--entitlements", plist, copy], { stdio: "inherit" });
  return copy;
}
