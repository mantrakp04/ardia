const areas: Record<string, Record<string, unknown>> = {};

export function devRegister(area: string, key: string | null, handle: unknown): () => void {
  if (!__DEV__) return () => {};
  const g = globalThis as Record<string, unknown>;
  if (key === null) {
    g[area] = handle;
    return () => void (g[area] === handle && delete g[area]);
  }
  const handles = (areas[area] ??= {});
  g[area] = handles;
  handles[key] = handle;
  return () => void (handles[key] === handle && delete handles[key]);
}
