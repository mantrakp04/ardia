import { readDocument, writeDocument } from "../../platform/documents";
import { isFields } from "../../lib/decode";
import { parseSaved, versionedJson } from "../../lib/savedDocument";
import { siteKey } from "./originMatch";

export const VAULT_ACCOUNTS_DOC = "vault-accounts.json";
export const MAX_REMEMBERED_ACCOUNTS = 500;
const VERSION = 1;

type Remembered = { key: string; at: number };

let accounts: Map<string, Remembered> | null = null;

const isRemembered = (v: unknown): v is Remembered => isFields(v) && typeof v.key === "string" && typeof v.at === "number";

function read(): Map<string, Remembered> {
  let doc: ReturnType<typeof parseSaved> = null;
  try {
    doc = parseSaved(readDocument(VAULT_ACCOUNTS_DOC), VERSION);
  } catch {
    doc = null;
  }
  const sites = doc && isFields(doc.sites) ? doc.sites : {};
  const entries = Object.entries(sites).filter((e): e is [string, Remembered] => isRemembered(e[1]));
  return new Map(entries.sort((a, b) => a[1].at - b[1].at).slice(-MAX_REMEMBERED_ACCOUNTS));
}

const loaded = () => (accounts ??= read());

function save(map: Map<string, Remembered>) {
  try {
    writeDocument(VAULT_ACCOUNTS_DOC, versionedJson({ sites: Object.fromEntries(map) }, VERSION));
  } catch (error) {
    console.warn("[vaults] couldn't save the remembered logins", error);
  }
}

export function rememberVaultAccount(origin: string, item: { provider: string; id: string }, now = Date.now()) {
  const site = siteKey(origin);
  if (!site) return;
  const map = loaded();
  map.delete(site);
  map.set(site, { key: `${item.provider}/${item.id}`, at: now });
  while (map.size > MAX_REMEMBERED_ACCOUNTS) map.delete(map.keys().next().value!);
  save(map);
}

export function rememberedVaultAccount(origin: string): string | null {
  const site = siteKey(origin);
  return (site && loaded().get(site)?.key) || null;
}

export const JUST_REMEMBERED_MS = 60_000;

export function forgetMissingVaultAccounts(provider: string, listed: ReadonlySet<string>, now = Date.now()) {
  const map = loaded();
  const prefix = `${provider}/`;
  let changed = false;
  for (const [site, entry] of map) {
    if (!entry.key.startsWith(prefix) || listed.has(entry.key.slice(prefix.length)) || now - entry.at < JUST_REMEMBERED_MS) continue;
    map.delete(site);
    changed = true;
  }
  if (changed) save(map);
}

export function reloadVaultAccounts() {
  accounts = null;
}

const filled = new Map<string, { origin: string; username: string }>();

export function noteFilledUsername(tabId: string, origin: string, username: string) {
  if (username) filled.set(tabId, { origin, username });
}

export function filledUsername(tabId: string, origin: string): string {
  const last = filled.get(tabId);
  return last && siteKey(last.origin) === siteKey(origin) ? last.username : "";
}
