export function inSample(id: string, rate: number): boolean {
  if (rate >= 1) return true;
  const bits = parseInt(id.replace(/-/g, "").slice(-8), 16);
  return Number.isFinite(bits) && bits / 0xffffffff < rate;
}

export function startWhenSampled(
  current: string,
  keep: (id: string) => boolean,
  onSessionChange: (fn: (id: string) => void) => void,
  start: () => void,
): void {
  if (keep(current)) {
    start();
    return;
  }
  let started = false;
  onSessionChange((next) => {
    if (started || !keep(next)) return;
    started = true;
    start();
  });
}
