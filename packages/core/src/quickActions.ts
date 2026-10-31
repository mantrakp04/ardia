export type QuickAction = { id: string; keyword: string; url: string };

export type QuickActionInput = { keyword: string; url: string };

export type QuickActionMatch = { exact: boolean; actions: QuickAction[] };

const NO_MATCH: QuickActionMatch = { exact: false, actions: [] };

export const quickActionKeyword = (keyword: string) => keyword.trim().toLowerCase().replace(/\s+/g, " ");

export function matchQuickActions(query: string, actions: readonly QuickAction[], limit = 3): QuickActionMatch {
  if (!actions.length) return NO_MATCH;
  const typed = quickActionKeyword(query);
  if (!typed) return NO_MATCH;
  const rank = (a: QuickAction) => (a.keyword === typed ? 0 : typed.length >= 2 && a.keyword.startsWith(typed) ? 1 : Infinity);
  const ranked = actions
    .map((a, order) => ({ a, r: rank(a), order }))
    .filter((x) => x.r !== Infinity)
    .sort((x, y) => x.r - y.r || x.order - y.order)
    .slice(0, limit);
  if (!ranked.length) return NO_MATCH;
  return { exact: ranked[0]!.r === 0, actions: ranked.map((x) => x.a) };
}

export function validateQuickAction(input: QuickActionInput, actions: readonly QuickAction[], ignoreId?: string): string | null {
  const keyword = quickActionKeyword(input.keyword);
  const url = input.url.trim();
  if (!keyword) return "Enter a keyword.";
  if (!/^https?:\/\/[^/?#\s]+/i.test(url)) return "Enter a URL that starts with http:// or https://.";
  if (actions.some((a) => a.id !== ignoreId && a.keyword === keyword)) return `“${keyword}” is already used by another quick action.`;
  return null;
}

export function makeQuickAction(input: QuickActionInput, id: string): QuickAction {
  return { id, keyword: quickActionKeyword(input.keyword), url: input.url.trim() };
}
