import type { VaultItem } from "../../platform/vaults";

export const MAX_PREVIOUS_USERNAMES = 5;

export type PreviousUsername = { username: string; item: VaultItem; count: number; usedAt: number };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const looksLikeEmail = (text: string) => EMAIL_SHAPE.test(text.trim());

export function previousUsernames(
  items: readonly VaultItem[],
  { email = false, limit = MAX_PREVIOUS_USERNAMES }: { email?: boolean; limit?: number } = {},
): PreviousUsername[] {
  const byName = new Map<string, PreviousUsername>();
  for (const item of items) {
    const username = item.username.trim();
    if (!username) continue;
    const key = username.toLowerCase();
    const usedAt = item.updatedAt ?? 0;
    const known = byName.get(key);
    if (!known) {
      byName.set(key, { username, item, count: 1, usedAt });
      continue;
    }
    known.count++;
    if (usedAt > known.usedAt) Object.assign(known, { username, item, usedAt });
  }
  const emailFirst = (a: PreviousUsername, b: PreviousUsername) => (email ? Number(looksLikeEmail(b.username)) - Number(looksLikeEmail(a.username)) : 0);
  return [...byName.values()]
    .sort((a, b) => emailFirst(a, b) || b.count - a.count || b.usedAt - a.usedAt || a.username.localeCompare(b.username))
    .slice(0, Math.max(0, limit));
}
