import { windowFor, type RangeKey } from "../../lib/range";
import { THRESHOLDS, type RuleKey } from "../../lib/thresholds";
import { compareVersions } from "../../lib/versions";
import { errorsExceptions } from "./errors";
import { funnelsRetention, funnelsSite } from "./funnels";
import { healthVersions } from "./health";
import { performanceAll, type Quantiles } from "./performance";
import { siteFriction } from "./site";
import { usersActive } from "./users";

export type Severity = "high" | "medium" | "low";
export type Page = "/users" | "/funnels" | "/health" | "/performance" | "/site" | "/errors";

export type Item = {
  key: string;
  rule: RuleKey | "unavailable";
  severity: Severity;
  title: string;
  value: string;
  comparison: string;
  to: Page;
  score: number;
  origin?: "site" | "app";
};

const pct = (n: number | null | undefined, digits = 1) => (n == null ? "–" : `${(n * 100).toFixed(digits)}%`);
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} s` : `${Math.round(n)} ms`);
const whole = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function newestPair<T extends { version: string; nightly: boolean }>(rows: T[], enough: (r: T) => boolean) {
  const stable = rows.filter((r) => !r.nightly && enough(r)).sort((a, b) => compareVersions(b.version, a.version));
  return { newest: stable[0] ?? null, previous: stable[1] ?? null };
}

export async function attention(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const [users, health, perf, site, retention, friction, errors] = await Promise.allSettled([
    usersActive(range, signal),
    healthVersions(range, signal),
    performanceAll(range, signal),
    funnelsSite(range, signal),
    funnelsRetention(range, signal),
    siteFriction(range, signal),
    errorsExceptions(range, signal),
  ]);
  const items: Item[] = [];
  const unavailable = (name: string, to: Page, result: PromiseRejectedResult) =>
    items.push({
      key: `unavailable-${name}`,
      rule: "unavailable",
      severity: "low",
      title: `Couldn't check ${name}`,
      value: String((result.reason as Error)?.message ?? result.reason).slice(0, 140),
      comparison: "The rest of the list still ran.",
      to,
      score: 0,
    });

  if (users.status === "fulfilled") {
    const y = users.value.yesterday;
    if (y && y.totalLow > 0 && y.coverageHigh < THRESHOLDS.coverageFull) {
      items.push({
        key: "coverage",
        rule: "coverage",
        severity: "low",
        title: `The daily count covers ${Math.round(y.coverageLow * 100)}–${pct(y.coverageHigh, 0)} of running copies`,
        value: `${whole(y.dau)} counted yesterday of about ${whole(y.totalLow)}–${whole(y.totalHigh)}`,
        comparison: `Versions before ${users.value.dailySince} don't send it, so daily, weekly and monthly actives rise as copies update, not as users arrive.`,
        to: "/users",
        score: 1 - y.coverageHigh,
      });
    }
  } else unavailable("users", "/users", users);

  if (health.status === "fulfilled") {
    const h = health.value;
    const newest = (nightly: boolean) => h.versions.filter((v) => v.nightly === nightly && v.users > 0).sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
    for (const latest of [newest(false), newest(true)]) {
      if (!latest) continue;
      for (const s of h.signatures) {
        const on = s.versions.find((v) => v.version === latest.version);
        if (!s.native || !on || s.firstVersion !== latest.version) continue;
        items.push({
          key: `crash-new-${s.key}`,
          rule: "crash-new",
          severity: "high",
          title: `New crash on ${latest.version}: ${s.type}${s.signal ? ` (${s.signal})` : ""}`,
          value: `${whole(on.count)} ${on.count === 1 ? "crash" : "crashes"}, ${whole(s.people)} ${s.people === 1 ? "person" : "people"}`,
          comparison: `Not seen on any earlier version. Top frames: ${s.signature}`,
          to: "/health",
          score: on.count,
        });
      }
    }
    const pair = newestPair(h.versions, (v) => v.users > 0);
    if (pair.newest && pair.previous) {
      const a = pair.newest;
      const b = pair.previous;
      const rateA = a.crashesPer100 ?? 0;
      const rateB = b.crashesPer100 ?? 0;
      if (a.crashes >= THRESHOLDS.minCrashes && (rateB === 0 || rateA >= rateB * THRESHOLDS.crashRateFactor)) {
        items.push({
          key: "crash-rate",
          rule: "crash-rate",
          severity: "high",
          title: `${a.version} crashes ${rateB ? `${(rateA / rateB).toFixed(1)}× as often as` : "where"} ${b.version}${rateB ? "" : " didn't"}`,
          value: `${rateA.toFixed(1)} crashes per 100 opted-in users (${whole(a.crashes)} from ${whole(a.users)})`,
          comparison: `${b.version}: ${rateB.toFixed(1)} per 100 (${whole(b.crashes)} from ${whole(b.users)})`,
          to: "/health",
          score: rateA,
        });
      }
    }
    const launches = newestPair(h.versions, (v) => v.launches >= THRESHOLDS.minLaunches);
    if (launches.newest && launches.previous && launches.newest.uncleanRate !== null && launches.previous.uncleanRate !== null) {
      const diff = launches.newest.uncleanRate - launches.previous.uncleanRate;
      if (diff >= THRESHOLDS.uncleanPoints) {
        items.push({
          key: "unclean-stable",
          rule: "unclean",
          severity: diff >= 0.05 ? "high" : "medium",
          title: `Unclean exits up on ${launches.newest.version}`,
          value: `${pct(launches.newest.uncleanRate)} of ${whole(launches.newest.launches)} launches followed an unclean exit`,
          comparison: `${launches.previous.version}: ${pct(launches.previous.uncleanRate)} of ${whole(launches.previous.launches)}, +${(diff * 100).toFixed(1)} pts`,
          to: "/health",
          score: diff * 100,
        });
      }
    }
    const cycleStart = launches.previous?.version ?? launches.newest?.version ?? "0";
    const nightlies = h.versions.filter(
      (x) => x.nightly && compareVersions(x.version, cycleStart) > 0 && x.launches >= THRESHOLDS.minLaunches && (x.uncleanRate ?? 0) >= THRESHOLDS.uncleanNightly,
    );
    for (const v of nightlies.slice(0, 3)) {
      items.push({
        key: `unclean-${v.version}`,
        rule: "unclean",
        severity: "medium",
        title: `${v.version} exits uncleanly often`,
        value: `${pct(v.uncleanRate)} of ${whole(v.launches)} launches followed an unclean exit (${whole(v.uncleanPeople)} people)`,
        comparison: launches.newest?.uncleanRate != null ? `Newest stable ${launches.newest.version}: ${pct(launches.newest.uncleanRate)}` : `Threshold ${pct(THRESHOLDS.uncleanNightly, 0)}`,
        to: "/health",
        score: (v.uncleanRate ?? 0) * 100,
      });
    }
  } else unavailable("app health", "/health", health);

  if (perf.status === "fulfilled") {
    const p = perf.value;
    const enough = (q: Quantiles | null) => !!q && q.count >= THRESHOLDS.minPerfSamples;
    const d = THRESHOLDS.perfMinDelta;
    const metrics: { key: string; label: string; pick: (r: (typeof p.versions)[number]) => Quantiles | null; format: (n: number) => string; minDelta: number }[] = [
      { key: "warm", label: "Normal launch", pick: (r) => r.warm, format: ms, minDelta: d.launch },
      { key: "first", label: "First launch after update", pick: (r) => r.first, format: ms, minDelta: d.launch },
      { key: "omnibox", label: "Omnibox p50", pick: (r) => r.omnibox50, format: ms, minDelta: d.omnibox },
      { key: "switch", label: "Profile switch", pick: (r) => r.switching, format: ms, minDelta: d.switch },
      { key: "memory", label: "Memory", pick: (r) => r.memory, format: (n) => `${whole(n)} MB`, minDelta: d.memory },
    ];
    for (const m of metrics) {
      const pair = newestPair(p.versions, (r) => enough(m.pick(r)));
      if (!pair.newest || !pair.previous) continue;
      const a = m.pick(pair.newest)!;
      const b = m.pick(pair.previous)!;
      if (b.p50 > 0 && a.p50 >= b.p50 * (1 + THRESHOLDS.perfWorse) && a.p50 - b.p50 >= m.minDelta) {
        items.push({
          key: `perf-${m.key}`,
          rule: "perf",
          severity: "medium",
          title: `${m.label} regressed on ${pair.newest.version}`,
          value: `${m.format(a.p50)} median, ${whole(a.count)} samples`,
          comparison: `${pair.previous.version}: ${m.format(b.p50)}, +${Math.round((a.p50 / b.p50 - 1) * 100)}%`,
          to: "/performance",
          score: a.p50 / b.p50,
        });
      }
    }
    const warm = p.launch.find((g) => g.group === "warm");
    const first = p.launch.find((g) => g.group === "first");
    const firstCold = p.launch.find((g) => g.group === "first-cold");
    if (warm && first && warm.p50 > 0 && first.count >= THRESHOLDS.minPerfSamples && first.p50 >= warm.p50 * THRESHOLDS.firstLaunchFactor) {
      items.push({
        key: "first-launch",
        rule: "first-launch",
        severity: "medium",
        title: `First launch after an update is ${(first.p50 / warm.p50).toFixed(1)}× slower`,
        value: `${ms(first.p50)} median to usable, against ${ms(warm.p50)} for a normal launch`,
        comparison: firstCold && firstCold.count >= 5 ? `First and cold: p90 ${ms(firstCold.p90)} over ${whole(firstCold.count)} launches` : `p90 ${ms(first.p90)} over ${whole(first.count)} launches`,
        to: "/performance",
        score: first.p50 / warm.p50,
      });
    }
  } else unavailable("performance", "/performance", perf);

  if (site.status === "fulfilled" && site.value.previous) {
    const c = site.value.current;
    const p = site.value.previous;
    const steps: { key: string; label: string; to: Page; num: (x: typeof c) => number; base: (x: typeof c) => number }[] = [
      { key: "mac", label: "Mac visitors → Download", to: "/funnels", num: (x) => x.macClickers, base: (x) => x.macVisitors },
      { key: "send", label: "Send to my Mac → shared or copied", to: "/funnels", num: (x) => x.succeeded, base: (x) => x.tappers },
      { key: "demo-shown", label: "Demo customize → setup code shown", to: "/funnels", num: (x) => x.demoShown, base: (x) => x.demoCustomize },
      { key: "demo-copied", label: "Demo customize → setup code copied", to: "/funnels", num: (x) => x.demoCopied, base: (x) => x.demoCustomize },
    ];
    for (const s of steps) {
      if (s.base(c) < THRESHOLDS.minFunnelBase || s.base(p) < THRESHOLDS.minFunnelBase) continue;
      const now = s.num(c) / s.base(c);
      const before = s.num(p) / s.base(p);
      if (before > 0 && now <= before * (1 - THRESHOLDS.funnelDrop)) {
        items.push({
          key: `funnel-${s.key}`,
          rule: "funnel",
          severity: "medium",
          title: `${s.label} dropped`,
          value: `${pct(now)} (${whole(s.num(c))} of ${whole(s.base(c))})`,
          comparison: `${pct(before)} the period before (${whole(s.num(p))} of ${whole(s.base(p))})`,
          to: s.to,
          score: before - now,
        });
      }
    }
  } else if (site.status === "rejected") unavailable("funnels", "/funnels", site);

  if (retention.status === "fulfilled") {
    const ready = retention.value.allCohorts.filter((c) => c.d1 !== null && c.size >= THRESHOLDS.minCohort);
    const latest = ready.at(-1);
    const before = ready.slice(-8, -1);
    const base = before.reduce((s, c) => s + c.size, 0);
    if (latest && base) {
      const rate = latest.d1! / latest.size;
      const prior = before.reduce((s, c) => s + c.d1!, 0) / base;
      if (prior - rate >= THRESHOLDS.retentionDropPoints) {
        items.push({
          key: "retention",
          rule: "retention",
          severity: "medium",
          title: "Day-1 retention fell for the newest cohort",
          value: `${pct(rate, 0)} of ${whole(latest.size)} opted-in people came back the next day`,
          comparison: `${pct(prior, 0)} across the ${before.length} cohorts before`,
          to: "/funnels",
          score: prior - rate,
        });
      }
    }
  } else unavailable("retention", "/funnels", retention);

  if (friction.status === "fulfilled" && friction.value.previousVisitors !== null) {
    const spots = friction.value.spots
      .filter(
        (s) =>
          (s.people >= THRESHOLDS.hotspotPeople && s.previousPeople === 0 && s.rate !== null && ((s.rate / 100) * (s.previousPageVisitors ?? 0)) >= THRESHOLDS.hotspotExpected) ||
          (s.people >= THRESHOLDS.hotspotPeople * 2 && s.rate !== null && s.previousRate !== null && s.previousRate > 0 && s.rate >= s.previousRate * THRESHOLDS.hotspotGrowth),
      )
      .slice(0, 3);
    for (const s of spots) {
      const fresh = s.previousPeople === 0;
      const name = s.text ? `"${s.text.slice(0, 48)}${s.text.length > 48 ? "…" : ""}"` : "an element with no text";
      items.push({
        key: `friction-${s.kind}-${s.path}-${s.text}`,
        rule: "friction",
        severity: fresh ? "medium" : "low",
        title: `${fresh ? "New" : "Growing"} ${s.kind === "Rage" ? "rage-click" : s.kind === "Swipe" ? "dead-swipe" : "dead-click"} spot on ${s.path}`,
        value: `${name}: ${whole(s.people)} people${s.rate !== null ? `, ${s.rate.toFixed(1)} per 100 page visitors` : ""}`,
        comparison: fresh ? "None the period before" : `${s.previousRate?.toFixed(1)} per 100 the period before`,
        to: "/site",
        score: s.people,
      });
    }
  } else if (friction.status === "rejected") unavailable("site friction", "/site", friction);

  if (errors.status === "fulfilled") {
    const fresh = errors.value.groups.filter((g) => !g.noise && g.firstSeen >= w.start);
    for (const g of fresh.slice(0, 3)) {
      items.push({
        key: `error-${g.id}`,
        rule: "errors",
        severity: g.where === "app" ? "medium" : "low",
        title: `New ${g.where} error: ${g.type}`,
        value: `${g.message.slice(0, 120) || "(no message)"}`,
        comparison: `${whole(g.count)}× by ${whole(g.people)} ${g.people === 1 ? "person" : "people"}, first seen in this range${g.versions[0] ? `, most on ${g.versions[0].version}` : ""}`,
        to: "/errors",
        score: g.count,
        origin: g.where,
      });
    }
    if (fresh.length > 3) {
      items.push({
        key: "error-more",
        rule: "errors",
        severity: "low",
        title: `${fresh.length - 3} more new error groups`,
        value: `${whole(fresh.slice(3).reduce((s, g) => s + g.count, 0))} events`,
        comparison: "Not known noise, first seen in this range",
        to: "/errors",
        score: 0,
      });
    }
  } else unavailable("errors", "/errors", errors);

  items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.score - a.score);

  const u = users.status === "fulfilled" ? users.value : null;
  const h = health.status === "fulfilled" ? health.value : null;
  const s = site.status === "fulfilled" ? site.value : null;
  const r = retention.status === "fulfilled" ? retention.value : null;
  const latestStable = h ? newestPair(h.versions, (v) => v.launches >= THRESHOLDS.minLaunches) : null;
  const d1Ready = r ? r.cohorts.filter((c) => c.d1 !== null) : [];
  const d1Size = d1Ready.reduce((sum, c) => sum + c.size, 0);

  return {
    range: w.range,
    items,
    kpis: {
      daily: u?.yesterday ?? null,
      dailySince: u?.dailySince ?? null,
      installs: u ? u.installs : null,
      macRate: s
        ? { value: s.current.macVisitors ? s.current.macClickers / s.current.macVisitors : null, previous: s.previous?.macVisitors ? s.previous.macClickers / s.previous.macVisitors : null }
        : null,
      d1: r ? { value: d1Size ? d1Ready.reduce((sum, c) => sum + c.d1!, 0) / d1Size : null, cohorts: d1Ready.length, people: d1Size } : null,
      unclean: latestStable?.newest ? { version: latestStable.newest.version, value: latestStable.newest.uncleanRate, previous: latestStable.previous?.uncleanRate ?? null, previousVersion: latestStable.previous?.version ?? null } : null,
    },
  };
}
