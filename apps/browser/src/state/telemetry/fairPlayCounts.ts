import type { FairPlayReport } from "../../platform/tabs";

type FairPlayStep = NonNullable<FairPlayReport["step"]>;

const FAIRPLAY_STEPS: readonly FairPlayStep[] = ["license", "playback", "player"];

let played = 0;
const failed: Record<FairPlayStep, number> = { license: 0, playback: 0, player: 0 };

const isFairPlayStep = (step: unknown): step is FairPlayStep => FAIRPLAY_STEPS.includes(step as FairPlayStep);

export function noteFairPlay(report: FairPlayReport) {
  if (report?.event === "played") played++;
  else if (report?.event === "failed" && isFairPlayStep(report.step)) failed[report.step]++;
}

export function takeFairPlayCounts() {
  const taken = { fairplay_played: played, fairplay_failed_license: failed.license, fairplay_failed_playback: failed.playback, fairplay_failed_player: failed.player };
  played = 0;
  for (const step of FAIRPLAY_STEPS) failed[step] = 0;
  return taken;
}
