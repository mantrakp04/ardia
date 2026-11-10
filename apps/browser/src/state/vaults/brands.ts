import { BRAND_ACCENTS, NEUTRAL_BRAND_ACCENT } from "./tokens";

export type VaultBrand = { id: string; name: string; symbol: string; install: string };

export const VAULT_BRANDS: readonly VaultBrand[] = [
  { id: "ardia", name: "Ardia", symbol: "key.fill", install: "" },
  { id: "1password", name: "1Password", symbol: "key.horizontal.fill", install: "brew install --cask 1password-cli" },
  { id: "bitwarden", name: "Bitwarden", symbol: "shield.lefthalf.filled", install: "brew install bitwarden-cli" },
  { id: "protonpass", name: "Proton Pass", symbol: "lock.shield.fill", install: "brew install protonpass/tap/pass-cli" },
];

const FALLBACK_SYMBOL = "key.fill";

export const brandOf = (id: string): VaultBrand => VAULT_BRANDS.find((b) => b.id === id) ?? { id, name: id, symbol: FALLBACK_SYMBOL, install: "" };

export const brandAccent = (id: string) => BRAND_ACCENTS[id] ?? NEUTRAL_BRAND_ACCENT;

export const brandRank = (id: string) => {
  const at = VAULT_BRANDS.findIndex((b) => b.id === id);
  return at < 0 ? VAULT_BRANDS.length : at;
};

export const byBrandOrder = <T extends { id: string; name: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => brandRank(a.id) - brandRank(b.id) || a.name.localeCompare(b.name));
