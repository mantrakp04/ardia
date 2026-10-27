export function classifyNoise(where: string, message: string, list: string, userAgent: string): string | null {
  if (where === "app") return null;
  let frames: { filename?: string }[] = [];
  try {
    const parsed = JSON.parse(list) as { stacktrace?: { frames?: { filename?: string }[] } }[];
    frames = parsed.flatMap((entry) => entry.stacktrace?.frames ?? []);
  } catch {
    frames = [];
  }
  if (/^Script error\.?$/.test(message)) return "Cross-origin script error";
  if (frames.some((frame) => /^(chrome|moz|safari(-web)?)-extension:/.test(frame.filename ?? ""))) return "Browser extension";
  if (/webkit\.messageHandlers|Twitter for|Instagram|FBAN|FBAV/.test(message + userAgent)) return "In-app browser";
  if (/Non-Error promise rejection captured with value: \{\}/.test(message)) return "Safari empty rejection";
  if (/ResizeObserver loop/.test(message)) return "ResizeObserver";
  if (/Load failed|Failed to fetch|NetworkError|network error/i.test(message)) return "Network drop";
  if (/wallet|ethereum|solana|metamask|LavaMoat/i.test(message)) return "Wallet extension";
  return null;
}
