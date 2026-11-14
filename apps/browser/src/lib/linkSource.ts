export type LinkSource = { bundleId: string | null; appName: string | null } | null;

export function sourceMatches(names: readonly string[], source: LinkSource): boolean {
  if (!names.length) return true;
  const given = [source?.bundleId, source?.appName].filter((n): n is string => !!n).map((n) => n.toLowerCase());
  return names.some((n) => given.includes(n.toLowerCase()));
}
