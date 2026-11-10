import type { VaultItem, VaultPasswordStyle, VaultProviderState } from "../../platform/vaults";
import { fillsWithoutChoice, rankItems, searchItems, TIER } from "./originMatch";
import type { PendingTotp } from "./pendingTotp";
import { SUGGEST_EVERYTHING, type VaultSuggest } from "./suggest";
import { previousUsernames } from "./usernames";
import type { VaultFieldKind } from "./types";

export type VaultRow =
  | { key: string; kind: "generate"; style: VaultPasswordStyle; spare?: boolean }
  | { key: string; kind: "otp"; item: VaultItem; pending: boolean; userChose: boolean }
  | { key: string; kind: "unlock"; provider: string; name: string }
  | { key: string; kind: "login"; item: VaultItem; userChose: boolean }
  | { key: string; kind: "username"; username: string; item: VaultItem }
  | { key: string; kind: "allPasswords" }
  | { key: string; kind: "suggest" }
  | { key: string; kind: "openPasswords" }
  | { key: string; kind: "settings" };

export type MenuMode = "matches" | "search";

export type MenuInput = {
  field: VaultFieldKind;
  mode: MenuMode;
  origin: string;
  query: string;
  providers: readonly VaultProviderState[];
  items: readonly VaultItem[];
  pending: PendingTotp | null;
  noTotp: ReadonlySet<string>;
  remembered?: string | null;
  email?: boolean;
  suggestOpen?: boolean;
  generated?: readonly VaultItem[];
  suggest?: VaultSuggest;
};

export const MAX_CODE_ROWS = 4;
export const MAX_SEARCH_ROWS = 100;

export const GENERATOR_STYLES: readonly VaultPasswordStyle[] = ["strong", "alphanumeric", "easyToType", "passphrase"];

export const FOOTER_KINDS: ReadonlySet<VaultRow["kind"]> = new Set(["allPasswords", "suggest", "openPasswords", "settings"]);

export const itemKey = (item: Pick<VaultItem, "provider" | "id">) => `${item.provider}/${item.id}`;
const loginRow = (item: VaultItem, origin: string): VaultRow => ({ key: `login:${itemKey(item)}`, kind: "login", item, userChose: !fillsWithoutChoice(item, origin) });
const generateRow = (style: VaultPasswordStyle): VaultRow => ({ key: `generate:${style}`, kind: "generate", style });
const spareGenerateRow = (style: VaultPasswordStyle): VaultRow => ({ key: `generate:${style}`, kind: "generate", style, spare: true });
const OTHER_PASSWORDS: VaultRow = { key: "allPasswords", kind: "allPasswords" };
const SETTINGS: VaultRow = { key: "settings", kind: "settings" };
const SUGGEST: VaultRow = { key: "suggest", kind: "suggest" };
const OPEN_PASSWORDS: VaultRow = { key: "openPasswords", kind: "openPasswords" };

const isOwnFillRow = (r: VaultRow) => r.kind === "login" || r.kind === "otp" || r.kind === "username" || (r.kind === "generate" && !r.spare);
export const hasMatchRow = (rows: readonly VaultRow[]) => rows.some((r) => isOwnFillRow(r) || r.kind === "unlock");
export const hasFillRow = (rows: readonly VaultRow[]) => rows.some(isOwnFillRow);

function codeRows(input: MenuInput, ranked: ReturnType<typeof rankItems>): VaultRow[] {
  const out: VaultRow[] = [];
  const seen = new Set<string>();
  const pendingItem = input.pending && input.items.find((i) => i.provider === input.pending!.provider && i.id === input.pending!.id);
  const add = (item: VaultItem, pending: boolean) => {
    const key = itemKey(item);
    if (seen.has(key) || input.noTotp.has(key) || out.length >= MAX_CODE_ROWS) return;
    seen.add(key);
    out.push({ key: `otp:${key}`, kind: "otp", item, pending, userChose: pending || !fillsWithoutChoice(item, input.origin) });
  };
  if (pendingItem && pendingItem.hasTotp !== false) add(pendingItem, true);
  for (const r of ranked) if (r.tier >= TIER.subdomain && r.item.hasTotp !== false) add(r.item, false);
  return out;
}

function usernameRows(input: MenuInput, items: readonly VaultItem[], shown: readonly VaultRow[]): VaultRow[] {
  const taken = new Set(shown.flatMap((r) => (r.kind === "login" ? [r.item.username.trim().toLowerCase()] : [])));
  return previousUsernames(items.filter((i) => !taken.has(i.username.trim().toLowerCase())), { email: !!input.email }).map(
    (u): VaultRow => ({ key: `username:${u.username.toLowerCase()}`, kind: "username", username: u.username, item: u.item }),
  );
}

function unlockRows(input: MenuInput): VaultRow[] {
  const order = new Map(input.providers.map((p, i) => [p.id, i]));
  return input.providers
    .filter((p) => p.state === "locked")
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((p): VaultRow => ({ key: `unlock:${p.id}`, kind: "unlock", provider: p.id, name: p.name }));
}

function savedRows(input: MenuInput, items: readonly VaultItem[], suggest: VaultSuggest): VaultRow[] {
  const ranked = rankItems(items, input.origin, input.remembered ?? null);
  if (input.field === "otp") return suggest.codes ? codeRows(input, ranked) : [];
  const rows = suggest.logins ? ranked.map((r) => loginRow(r.item, input.origin)) : [];
  if (input.field === "username" && suggest.usernames) rows.push(...usernameRows(input, items, rows));
  return rows;
}

const wantsSaved = (field: VaultFieldKind, suggest: VaultSuggest) =>
  field === "otp" ? suggest.codes : field === "username" ? suggest.logins || suggest.usernames : suggest.logins;

export function menuRows(input: MenuInput): VaultRow[] {
  const suggest = input.suggest ?? SUGGEST_EVERYTHING;
  const unlocked = new Set(input.providers.filter((p) => p.state === "unlocked").map((p) => p.id));
  const items = input.items.filter((i) => unlocked.has(i.provider));
  if (input.mode === "search") {
    const kept = suggest.generated ? (input.generated ?? []).map((item): VaultRow => ({ key: `login:${itemKey(item)}`, kind: "login", item, userChose: true })) : [];
    return [...kept, ...searchItems(items, input.query, MAX_SEARCH_ROWS).map((item) => loginRow(item, input.origin))];
  }
  if (input.field === "newPassword") {
    if (!suggest.newPasswords) return [OPEN_PASSWORDS];
    return [...(unlocked.size ? GENERATOR_STYLES.map(generateRow) : []), ...unlockRows(input), OPEN_PASSWORDS];
  }
  const rows = savedRows(input, items, suggest);
  if (wantsSaved(input.field, suggest)) rows.push(...unlockRows(input));
  const matched = hasMatchRow(rows);
  if (input.field === "password" && unlocked.size && suggest.newPasswords) rows.push(...(input.suggestOpen ? GENERATOR_STYLES.map(spareGenerateRow) : [SUGGEST]));
  return matched ? [...rows, OTHER_PASSWORDS] : [...rows, OTHER_PASSWORDS, SETTINGS];
}

export function restingRow(rows: readonly VaultRow[], remembered: string | null = null) {
  const own = remembered ? rows.findIndex((r) => (r.kind === "login" || r.kind === "otp") && itemKey(r.item) === remembered) : -1;
  if (own >= 0) return own;
  const fill = rows.findIndex(isOwnFillRow);
  return fill >= 0 ? fill : rows.findIndex((r) => r.kind === "unlock");
}

export type MenuKeyResult = { selected: number; action: "none" | "move" | "activate" | "close" };

export function menuKey(selected: number, count: number, key: string): MenuKeyResult {
  switch (key) {
    case "Escape":
    case "Tab":
      return { selected: -1, action: "close" };
    case "Enter":
      return selected >= 0 && selected < count ? { selected, action: "activate" } : { selected: -1, action: "close" };
    case "ArrowDown":
      if (!count) return { selected: -1, action: "none" };
      return { selected: selected < 0 || selected >= count - 1 ? 0 : selected + 1, action: "move" };
    case "ArrowUp":
      if (!count) return { selected: -1, action: "none" };
      return { selected: selected <= 0 || selected >= count ? count - 1 : selected - 1, action: "move" };
    default:
      return { selected, action: "none" };
  }
}
