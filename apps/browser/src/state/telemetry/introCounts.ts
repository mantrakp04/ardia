let shown = 0;
let mutedAtStart = 0;
let skipped = 0;

export function noteIntroShown(musicMuted: boolean) {
  shown += 1;
  if (musicMuted) mutedAtStart += 1;
}

export const noteIntroSkipped = () => void (skipped += 1);

export function takeIntroCounts() {
  const taken = { intros_shown: shown, intros_music_muted: mutedAtStart, intros_skipped: skipped };
  shown = 0;
  mutedAtStart = 0;
  skipped = 0;
  return taken;
}
