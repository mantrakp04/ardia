let releaseNotesHeld = 0;

export const noteReleaseNotesHeldForFirstRun = () => void (releaseNotesHeld += 1);

export function takeFirstRunCounts() {
  const taken = { release_notes_held_for_first_run: releaseNotesHeld };
  releaseNotesHeld = 0;
  return taken;
}
