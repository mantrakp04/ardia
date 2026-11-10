import { useMemo } from "react";
import type { VaultItem } from "../../platform/vaults";
import { previousUsernames } from "./usernames";

export const MAX_USERNAME_SUGGESTIONS = 4;
const RANKED_USERNAMES = 12;

export const rankedUsernames = (items: readonly VaultItem[], email: boolean) => previousUsernames(items, { email, limit: RANKED_USERNAMES }).map((u) => u.username);

export function usernameCompletions(ranked: readonly string[], typed: string, limit = MAX_USERNAME_SUGGESTIONS): string[] {
  const text = typed.trim().toLowerCase();
  const matching = ranked.filter((u) => {
    const name = u.toLowerCase();
    return name !== text && name.includes(text);
  });
  const starts = matching.filter((u) => u.toLowerCase().startsWith(text));
  const rest = matching.filter((u) => !u.toLowerCase().startsWith(text));
  return [...starts, ...rest].slice(0, Math.max(0, limit));
}

export function stepCompletion(selected: number, count: number, direction: "up" | "down"): number {
  if (count <= 0) return -1;
  if (direction === "down") return selected < 0 || selected >= count - 1 ? 0 : selected + 1;
  return selected <= 0 || selected >= count ? count - 1 : selected - 1;
}

export const prefilledUsername = (current: string, ranked: readonly string[]) => (current.trim() ? current : (ranked[0] ?? current));

export function useRankedUsernames(items: readonly VaultItem[], email: boolean): string[] {
  return useMemo(() => rankedUsernames(items, email), [items, email]);
}
