import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const APP_DIR = join(import.meta.dirname, "..");
const REPO_DIR = join(APP_DIR, "..", "..");
const LOCKFILE = join(REPO_DIR, "pnpm-lock.yaml");
const MODULE_GRADLE = join(REPO_DIR, "packages", "phone", "android", "build.gradle");
export const CREDITS_FILE = join(APP_DIR, "src", "state", "settings", "credits.json");

export type PackageCredit = { name: string; version: string; license: string; url: string };
export type NativeCredit = { name: string; artifacts: string[]; license: string; url: string };
export type Credits = { inputs: string; packages: PackageCredit[]; native: NativeCredit[] };

const NATIVE_LIBRARIES: { group: string; name: string; license: string; url: string }[] = [
  { group: "androidx.", name: "Android Jetpack (AndroidX)", license: "Apache-2.0", url: "https://developer.android.com/jetpack/androidx" },
  { group: "com.squareup.okhttp3", name: "OkHttp", license: "Apache-2.0", url: "https://github.com/square/okhttp" },
  { group: "org.jetbrains.kotlinx", name: "Kotlin coroutines and serialization", license: "Apache-2.0", url: "https://github.com/Kotlin" },
  { group: "com.google.re2j", name: "RE2/J", license: "BSD-3-Clause", url: "https://github.com/google/re2j" },
  { group: "com.google.zxing", name: "ZXing", license: "Apache-2.0", url: "https://github.com/zxing/zxing" },
];

const BUNDLED_WITH_NPM = ["com.facebook.react"];

export function importerBlock(lockfile: string, importer: string): string {
  const start = lockfile.indexOf(`\n  ${importer}:\n`);
  if (start < 0) throw new Error(`${importer} is not in the lockfile`);
  const rest = lockfile.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}\S|\n\S/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

export function gradleArtifacts(gradle: string): string[] {
  return [...gradle.matchAll(/^\s*(?:implementation|api)\s+["']([^"':]+:[^"':]+)(?::[^"']*)?["']/gm)].map((match) => match[1]!);
}

export function creditInputs(): string {
  const lockfile = readFileSync(LOCKFILE, "utf8");
  const inputs = [importerBlock(lockfile, "apps/phone"), importerBlock(lockfile, "packages/core"), gradleArtifacts(readFileSync(MODULE_GRADLE, "utf8")).join("\n")];
  return createHash("sha256").update(inputs.join("\n---\n")).digest("hex");
}

export function nativeCredits(artifacts: readonly string[]): NativeCredit[] {
  const byName = new Map<string, NativeCredit>();
  for (const artifact of artifacts) {
    if (BUNDLED_WITH_NPM.some((group) => artifact.startsWith(group))) continue;
    const library = NATIVE_LIBRARIES.find((entry) => artifact.startsWith(entry.group));
    if (!library) throw new Error(`no license recorded for ${artifact}: add it to NATIVE_LIBRARIES in test/credits.ts`);
    const known = byName.get(library.name) ?? { name: library.name, artifacts: [], license: library.license, url: library.url };
    known.artifacts.push(artifact);
    byName.set(library.name, known);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function packageRoot(source: string): string | null {
  const at = source.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = source.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]!.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]!;
  return `${source.slice(0, at)}/node_modules/${name}`;
}

export function repositoryUrl(manifest: { name: string; repository?: string | { url?: string }; homepage?: string }): string {
  const raw = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (raw) {
    const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(raw);
    if (short) return `https://github.com/${short[1]}`;
    const cleaned = raw.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "");
    if (/^https?:\/\//.test(cleaned)) return cleaned;
  }
  return manifest.homepage ?? `https://www.npmjs.com/package/${manifest.name}`;
}

export function bundledPackages(sources: readonly string[]): PackageCredit[] {
  const roots = new Set<string>();
  for (const source of sources) {
    const root = packageRoot(source);
    if (root) roots.add(root);
  }
  const credits = new Map<string, PackageCredit>();
  for (const root of roots) {
    const manifestPath = [join(root, "package.json"), join(REPO_DIR, root, "package.json")].find((path) => existsSync(path));
    if (!manifestPath) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (String(manifest.name).startsWith("@ardia/")) continue;
    credits.set(`${manifest.name}@${manifest.version}`, {
      name: manifest.name,
      version: manifest.version,
      license: typeof manifest.license === "string" ? manifest.license : "See the package",
      url: repositoryUrl(manifest),
    });
  }
  return [...credits.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function write(sourceMap: string) {
  const map = JSON.parse(readFileSync(sourceMap, "utf8"));
  const credits: Credits = {
    inputs: creditInputs(),
    packages: bundledPackages(map.sources),
    native: nativeCredits(gradleArtifacts(readFileSync(MODULE_GRADLE, "utf8"))),
  };
  writeFileSync(CREDITS_FILE, `${JSON.stringify(credits, null, 2)}\n`);
  console.log(`credits: ${credits.packages.length} packages, ${credits.native.length} native libraries`);
}

if (process.argv[2] === "--write" && process.argv[3]) write(process.argv[3]);
