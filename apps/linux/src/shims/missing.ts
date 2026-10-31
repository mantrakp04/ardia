const seen = new Set<string>();

export function noteMissing(what: string) {
  if (seen.has(what)) return;
  seen.add(what);
  console.info(`[ardia linux] unavailable: ${what}`);
}

export const missingOnWeb = () => [...seen].sort();

Object.assign(globalThis, { ardiaLinuxMissing: missingOnWeb });
