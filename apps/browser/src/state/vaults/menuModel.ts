import type { VaultItem, VaultProviderState } from "../../platform/vaults";
import { rankItems, searchItems, TIER } from "./originMatch";
import type { PendingTotp } from "./pendingTotp";
import type { VaultFieldKind } from "./types";

export type VaultRow =
  | { key: string; kind: "generate" }
  | { key: string; kind: "otp"; item: VaultItem; pending: boolean }
  | { key: string; kind: "unlock"; provider: string; name: string }
  | { key: string; kind: "login"; item: VaultItem; userChose: boolean }
  | { key: string; kind: "allPasswords" }
  | { key: string; kind: "suggest" }
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
};

export const MAX_CODE_ROWS = 4;
export const MAX_SEARCH_ROWS = 100;

export const itemKey = (item: Pick<VaultItem, "provider" | "id">) => `${item.provider}/${item.id}`;
const loginRow = (item: VaultItem, userChose: boolean): VaultRow => ({ key: `login:${itemKey(item)}`, kind: "login", item, userChose });
const OTHER_PASSWORDS: VaultRow = { key: "allPasswords", kind: "allPasswords" };
const SETTINGS: VaultRow = { key: "settings", kind: "settings" };
const SUGGEST: VaultRow = { key: "suggest", kind: "suggest" };

export const hasMatchRow = (rows: readonly VaultRow[]) => rows.some((r) => r.kind === "login" || r.kind === "otp" || r.kind === "generate" || r.kind === "unlock");

function codeRows(input: MenuInput, ranked: ReturnType<typeof rankItems>): VaultRow[] {
  const out: VaultRow[] = [];
  const seen = new Set<string>();
  const pendingItem = input.pending && input.items.find((i) => i.provider === input.pending!.provider && i.id === input.pending!.id);
  const add = (item: VaultItem, pending: boolean) => {
    const key = itemKey(item);
    if (seen.has(key) || input.noTotp.has(key) || out.length >= MAX_CODE_ROWS) return;
    seen.add(key);
    out.push({ key: `otp:${key}`, kind: "otp", item, pending });
  };
  if (pendingItem && pendingItem.hasTotp !== false) add(pendingItem, true);
  for (const r of ranked) if (r.tier >= TIER.subdomain && r.item.hasTotp !== false) add(r.item, false);
  return out;
}

export function menuRows(input: MenuInput): VaultRow[] {
  const providerOrder = new Map(input.providers.map((p, i) => [p.id, i]));
  const unlocked = new Set(input.providers.filter((p) => p.state === "unlocked").map((p) => p.id));
  const items = input.items.filter((i) => unlocked.has(i.provider));
  if (input.mode === "search") {
    const ranked = new Map(rankItems(items, input.origin).map((r) => [itemKey(r.item), r.tier]));
    return searchItems(items, input.query, MAX_SEARCH_ROWS).map((item) => loginRow(item, (ranked.get(itemKey(item)) ?? TIER.none) < TIER.subdomain));
  }
  const rows: VaultRow[] = [];
  if (input.field === "newPassword" && unlocked.size) rows.push({ key: "generate", kind: "generate" });
  const ranked = rankItems(items, input.origin);
  if (input.field === "otp") rows.push(...codeRows(input, ranked));
  else rows.push(...ranked.map((r) => loginRow(r.item, r.tier < TIER.subdomain)));
  const locked = input.providers.filter((p) => p.state === "locked").sort((a, b) => (providerOrder.get(a.id) ?? 0) - (providerOrder.get(b.id) ?? 0));
  rows.push(...locked.map((p): VaultRow => ({ key: `unlock:${p.id}`, kind: "unlock", provider: p.id, name: p.name })));
  const footer = input.field === "password" && unlocked.size ? [OTHER_PASSWORDS, SUGGEST] : [OTHER_PASSWORDS];
  return hasMatchRow(rows) ? [...rows, ...footer] : [...rows, ...footer, SETTINGS];
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
