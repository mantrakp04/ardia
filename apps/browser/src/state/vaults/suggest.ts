import type { Settings } from "../settings/settings";

export type VaultSuggest = { logins: boolean; codes: boolean; usernames: boolean; newPasswords: boolean; generated: boolean };

export const SUGGEST_EVERYTHING: VaultSuggest = { logins: true, codes: true, usernames: true, newPasswords: true, generated: true };

type SuggestSettings = Pick<Settings, "vaultSuggestLogins" | "vaultSuggestCodes" | "vaultSuggestUsernames" | "vaultSuggestNewPasswords" | "vaultSuggestGenerated">;

export const suggestOf = (s: SuggestSettings): VaultSuggest => ({
  logins: s.vaultSuggestLogins,
  codes: s.vaultSuggestCodes,
  usernames: s.vaultSuggestUsernames,
  newPasswords: s.vaultSuggestNewPasswords,
  generated: s.vaultSuggestGenerated,
});
