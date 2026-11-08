export type ServerChoice = "us" | "eu" | "self";

export const BITWARDEN_EU = "https://vault.bitwarden.eu";
const US_HOSTS = new Set(["bitwarden.com", "vault.bitwarden.com"]);
const EU_HOSTS = new Set(["bitwarden.eu", "vault.bitwarden.eu"]);

const hostOf = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export function serverChoiceOf(server: string | undefined | null): ServerChoice {
  if (!server?.trim()) return "us";
  const host = hostOf(server);
  return US_HOSTS.has(host) ? "us" : EU_HOSTS.has(host) ? "eu" : "self";
}

export function bitwardenServer(choice: ServerChoice, url: string): string | null {
  if (choice === "us") return null;
  if (choice === "eu") return BITWARDEN_EU;
  const text = url.trim().replace(/\/+$/, "");
  if (!text || /\s/.test(text)) return null;
  const full = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return /^https?:\/\/[^/?#\s]+\.[^/?#\s]+|^https?:\/\/localhost(:\d+)?/i.test(full) ? full : null;
}
