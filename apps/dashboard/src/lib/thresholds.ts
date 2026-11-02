export const THRESHOLDS = {
  coverageFull: 0.95,
  uncleanPoints: 0.02,
  uncleanNightly: 0.1,
  minLaunches: 30,
  crashRateFactor: 1.5,
  minCrashes: 3,
  perfWorse: 0.15,
  minPerfSamples: 20,
  perfMinDelta: { launch: 100, omnibox: 2, switch: 10, memory: 100 },
  firstLaunchFactor: 2,
  funnelDrop: 0.15,
  minFunnelBase: 150,
  retentionDropPoints: 0.1,
  minCohort: 20,
  hotspotPeople: 5,
  hotspotGrowth: 2,
  hotspotExpected: 3,
  frictionWindowMs: 10_000,
} as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export const RULES = [
  { key: "coverage", text: `Daily count covers under ${pct(THRESHOLDS.coverageFull)} of running copies` },
  { key: "crash-new", text: "A crash signature on the newest stable or nightly that no earlier version had" },
  { key: "crash-rate", text: `Crashes per 100 opted-in users on the newest stable at ${THRESHOLDS.crashRateFactor}× the previous stable or more (${THRESHOLDS.minCrashes}+ crashes)` },
  {
    key: "unclean",
    text: `Unclean exits on the newest stable ${Math.round(THRESHOLDS.uncleanPoints * 100)}+ points above the previous stable, or a nightly since the previous stable at ${pct(THRESHOLDS.uncleanNightly)}+ (${THRESHOLDS.minLaunches}+ launches)`,
  },
  { key: "perf", text: `A median on the newest stable ${pct(THRESHOLDS.perfWorse)}+ slower or heavier than the previous stable and by at least ${THRESHOLDS.perfMinDelta.launch} ms for launches, ${THRESHOLDS.perfMinDelta.omnibox} ms for the omnibox, ${THRESHOLDS.perfMinDelta.switch} ms for profile switches or ${THRESHOLDS.perfMinDelta.memory} MB (${THRESHOLDS.minPerfSamples}+ samples each)` },
  { key: "first-launch", text: `First launch after an update ${THRESHOLDS.firstLaunchFactor}× slower than a normal launch or more` },
  { key: "funnel", text: `A funnel step converting ${pct(THRESHOLDS.funnelDrop)}+ worse than the period before (${THRESHOLDS.minFunnelBase}+ people at the step above)` },
  { key: "retention", text: `D1 retention of the latest cohort ${Math.round(THRESHOLDS.retentionDropPoints * 100)}+ points under the cohorts before it (${THRESHOLDS.minCohort}+ people)` },
  {
    key: "friction",
    text: `A rage or dead click spot with ${THRESHOLDS.hotspotPeople}+ people that was quiet the period before although its rate would have made ${THRESHOLDS.hotspotExpected}+ expected, or one at ${THRESHOLDS.hotspotGrowth}× its rate per page visitor (${THRESHOLDS.hotspotPeople * 2}+ people). Clicks followed by a tracked event within ${THRESHOLDS.frictionWindowMs / 1000} s don't count`,
  },
  { key: "errors", text: "An error group first seen in the range that isn't known noise" },
] as const;

export type RuleKey = (typeof RULES)[number]["key"];
