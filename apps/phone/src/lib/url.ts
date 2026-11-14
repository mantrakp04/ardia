export function displayHost(host: string, url: string): string {
  const bare = host.replace(/^www\./i, "");
  return bare || url;
}

export function landingKey(url: string): string {
  const match = /^(https?):\/\/([^/?#]*)([^#]*)/i.exec(url.trim());
  if (!match) return url.trim();
  const rest = match[3]!.replace(/\/+(?=\?|$)/, "");
  return `${match[2]!.toLowerCase()}${rest}`;
}

export function dedupeByLanding<T extends { url: string; opensTab: boolean }>(rows: readonly T[]): T[] {
  const kept: T[] = [];
  const at = new Map<string, number>();
  for (const row of rows) {
    const key = landingKey(row.url);
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, kept.length);
      kept.push(row);
    } else if (row.opensTab && !kept[seen]!.opensTab) kept[seen] = row;
  }
  return kept;
}
