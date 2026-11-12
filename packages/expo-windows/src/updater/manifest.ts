export type Installer = { url: string; sha256: string; bytes: number };
export type UpdateManifest = { version: string; build: number; installers: Partial<Record<Cpu, Installer>> };
export type BuildIdentity = { version: string; build: number };
export type Cpu = "x64" | "arm64";

const CPUS: Cpu[] = ["x64", "arm64"];
const LARGEST_INSTALLER_BYTES = 2 ** 30;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isBuild = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isVersion = (value: unknown): value is string => typeof value === "string" && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(value);

function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function readInstaller(value: unknown, publishedUnder: string): Installer | null {
  if (!isRecord(value)) return null;
  const { url, sha256, bytes } = value;
  if (typeof url !== "string" || !url.startsWith(publishedUnder) || !/^[\x21-\x7e]+\.exe$/.test(url) || url.includes("..")) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > LARGEST_INSTALLER_BYTES) return null;
  return { url, sha256, bytes };
}

export function readBuild(text: string): BuildIdentity | null {
  const value = parsed(text);
  if (!value || !isVersion(value.version) || !isBuild(value.build)) return null;
  return { version: value.version, build: value.build };
}

export function readManifest(text: string, publishedUnder: string): UpdateManifest | null {
  const value = parsed(text);
  if (!value || !isVersion(value.version) || !isBuild(value.build)) return null;
  const installers: Partial<Record<Cpu, Installer>> = {};
  for (const cpu of CPUS) {
    const installer = readInstaller(value[cpu], publishedUnder);
    if (installer) installers[cpu] = installer;
  }
  return { version: value.version, build: value.build, installers };
}

export function offered(manifest: UpdateManifest, cpu: string, current: number): Installer | null {
  if (manifest.build <= current) return null;
  return (cpu === "x64" || cpu === "arm64" ? manifest.installers[cpu] : undefined) ?? null;
}

export function failureText(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (typeof error === "object" && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string" && message) return message;
  }
  return "the check failed";
}

export const folderOf = (address: string) => address.slice(0, address.lastIndexOf("/") + 1);

export const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));
