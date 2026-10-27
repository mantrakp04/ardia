import type { RangeKey } from "../../lib/range";
import { githubPage } from "../github";
import { attention } from "./attention";
import { errorsExceptions, errorsLogs } from "./errors";
import { funnelsInstalls, funnelsRetention, funnelsSite } from "./funnels";
import { healthVersions } from "./health";
import { performanceAll } from "./performance";
import { siteBreakdowns, siteClicks, siteExperiment, siteFriction, siteTraffic, siteVitals } from "./site";
import { usersActive, usersOptedIn, usersUsage, usersVersions } from "./users";

export const sections = {
  attention,
  "users.active": usersActive,
  "users.versions": usersVersions,
  "users.optedIn": usersOptedIn,
  "users.usage": usersUsage,
  "funnels.site": funnelsSite,
  "funnels.installs": funnelsInstalls,
  "funnels.retention": funnelsRetention,
  health: healthVersions,
  performance: performanceAll,
  "site.traffic": siteTraffic,
  "site.breakdowns": siteBreakdowns,
  "site.clicks": siteClicks,
  "site.friction": siteFriction,
  "site.experiment": siteExperiment,
  "site.vitals": siteVitals,
  "errors.exceptions": errorsExceptions,
  "errors.logs": errorsLogs,
  github: (_range: RangeKey) => githubPage(),
} satisfies Record<string, (range: RangeKey, signal?: AbortSignal) => Promise<unknown>>;

export type Sections = typeof sections;
export type SectionName = keyof Sections;
export type SectionData<N extends SectionName> = Awaited<ReturnType<Sections[N]>>;
