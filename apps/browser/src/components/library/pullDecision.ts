export const PULL_OPENS_AT = 0.45;
export const RUBBER_FULL_PULL = 0.09;
const PULL_STARTS_AT = 0.02;

export type PullTrack = { pulling: boolean; held: number | null };
export type PullStep = PullTrack & { open: number | null };

export function pullProgress(position: number): number {
  return Math.min(1, Math.max(0, -position / RUBBER_FULL_PULL));
}

export function trackPull(track: PullTrack, progress: number, fingerDown: boolean): PullStep {
  if (!track.pulling) {
    if (!fingerDown || progress <= PULL_STARTS_AT) return { ...track, open: null };
    return { pulling: true, held: progress, open: null };
  }
  if (fingerDown) return { pulling: true, held: progress, open: null };
  if (track.held === null) return { ...track, open: null };
  const open = track.held >= PULL_OPENS_AT ? track.held : null;
  return { pulling: open === null, held: null, open };
}
