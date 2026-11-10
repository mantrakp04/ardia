import type {
  VaultContextChoice,
  VaultContextField,
  VaultContextLogin,
  VaultContextMenu,
  VaultFillField,
  VaultItem,
  VaultPasswordStyle,
  VaultProviderState,
} from "../../platform/vaults";
import { GENERATOR_STYLES } from "./menuModel";
import { isSecureOrigin, matchTier, rankItems, siteLabel, TIER } from "./originMatch";

export const MAX_CONTEXT_LOGINS = 8;

export const CONTEXT_NOTES = {
  insecure: "Not Available on This Page",
  noLogins: "No Logins for This Site",
} as const;

export const CONTEXT_GENERATOR_TITLES: Record<VaultPasswordStyle, string> = {
  strong: "Strong Password",
  alphanumeric: "Strong Password Without Special Characters",
  easyToType: "Easy-to-Type Password",
  passphrase: "Memorable Password",
};

export type ContextMenuInput = {
  origin: string;
  providers: readonly VaultProviderState[];
  items: readonly VaultItem[];
  remembered: string | null;
};

export const contextLoginKey = (item: Pick<VaultItem, "provider" | "id">) => `${item.provider}/${item.id}`;

function siteOf(item: VaultItem, origin: string): string {
  const url = item.urls.find((u) => matchTier(origin, u) > TIER.none) ?? item.urls[0];
  return url ? siteLabel(url) : "";
}

function choicesOf(item: VaultItem): VaultContextChoice[] {
  const choices: VaultContextChoice[] = [];
  if (item.username.trim()) choices.push("username");
  choices.push("password");
  if (item.hasTotp === true) choices.push("otp");
  return choices;
}

function titlesOf(items: readonly VaultItem[], origin: string, providerName: (id: string) => string): string[] {
  const plain = items.map((item) => {
    const who = item.username.trim() || item.title.trim();
    const site = siteOf(item, origin);
    return site && site !== who ? `${who} · ${site}` : who || site;
  });
  return plain.map((title, i) => (plain.indexOf(title) !== plain.lastIndexOf(title) ? `${title} (${providerName(items[i]!.provider)})` : title));
}

export function contextMenuModel(input: ContextMenuInput): VaultContextMenu {
  const unlocked = new Set(input.providers.filter((p) => p.state === "unlocked").map((p) => p.id));
  const unlock = input.providers.some((p) => p.state === "locked");
  if (!isSecureOrigin(input.origin)) return { logins: [], unlock: false, other: false, note: CONTEXT_NOTES.insecure };
  const items = input.items.filter((i) => unlocked.has(i.provider));
  const ranked = rankItems(items, input.origin, input.remembered).slice(0, MAX_CONTEXT_LOGINS).map((r) => r.item);
  const names = new Map(input.providers.map((p) => [p.id, p.name]));
  const titles = titlesOf(ranked, input.origin, (id) => names.get(id) ?? id);
  const logins: VaultContextLogin[] = ranked.map((item, i) => ({ key: contextLoginKey(item), title: titles[i]!, fields: choicesOf(item) }));
  const other = unlocked.size > 0;
  return { logins, unlock, other, note: logins.length || !other ? null : CONTEXT_NOTES.noLogins };
}

export const fillFieldOf = (choice: VaultContextChoice): VaultFillField => (choice === "otp" ? "totp" : choice);

export function pickedFillFields(field: Pick<VaultContextField, "kind" | "guess">): VaultFillField[] {
  if (field.kind === "otp") return ["totp"];
  if (field.kind === "username" || field.kind === "password") return ["username", "password"];
  return [fillFieldOf(field.guess)];
}

export const menuFieldOf = (field: Pick<VaultContextField, "kind" | "guess">) =>
  field.kind === "username" || field.kind === "password" || field.kind === "otp" ? field.kind : field.guess;

export function contextMenuOptions(connected: boolean, generate: boolean) {
  const generators = GENERATOR_STYLES.map((style) => ({ style, title: CONTEXT_GENERATOR_TITLES[style] }));
  return { autofill: connected, generate: connected && generate ? generators : [] };
}
