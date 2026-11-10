export type CliCaller = { name: string; app: string | null };

export const CLI_CALLER_FALLBACK = "ardia";
const MAX_NAME = 40;
const MAX_APP_PATH = 1024;
const INVISIBLE = /[\p{C}]/gu;
const SPACES = /[\s\p{Z}]+/gu;
const BUNDLE = /^\/.+\.app$/;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(SPACES, " ").replace(INVISIBLE, "").replace(SPACES, " ").trim();
  const name = [...flat].slice(0, MAX_NAME).join("").trim();
  return name || null;
}

function cleanApp(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_APP_PATH || !BUNDLE.test(raw)) return null;
  const parts = raw.split("/");
  if (parts.some((part) => part === ".." || part === ".")) return null;
  return parts.slice(0, -1).some((part) => part.endsWith(".app")) ? null : raw;
}

export function parseCliCaller(raw: unknown): CliCaller | null {
  if (!raw || typeof raw !== "object") return null;
  const fields = raw as { name?: unknown; app?: unknown };
  const name = cleanName(fields.name);
  return name ? { name, app: cleanApp(fields.app) } : null;
}

export type ControlLine = { lead: string; name: string; rest: string };

export function controlLine(caller: CliCaller | null): ControlLine {
  const name = caller?.name ?? CLI_CALLER_FALLBACK;
  if (name.toLowerCase() === CLI_CALLER_FALLBACK) return { lead: "The ", name: CLI_CALLER_FALLBACK, rest: " command is controlling Ardia" };
  return { lead: "", name, rest: " is controlling Ardia" };
}

export const controlLineText = ({ lead, name, rest }: ControlLine) => `${lead}${name}${rest}`;
