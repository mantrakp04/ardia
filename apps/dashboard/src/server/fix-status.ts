import { compareVersions } from "../lib/versions.ts";
import type { Release } from "./github.ts";

const DAY = 86_400_000;
const APP_VERSION = /^\d+\.\d+\.\d+(-nightly\.\d+)?$/;

export type Issue = { number: number; state: "open" | "closed"; reason: string; closedAt: number | null; title: string; url: string };

export type FixState = "no-issue" | "open" | "not-planned" | "unreleased" | "fixed" | "not-seen" | "came-back";
export type FixStatus = { state: FixState; version: string | null; label: string; errorTypes: string[] };

export type InstallHistory = { versions: string[]; exceptions: { at: number; version: string; type: string }[] };

export type FixInput = { at: number; issueNumber: number | null; channel: string };

export function fixRelease(closedAt: number, channel: string, releases: Release[]): Release | null {
  const eligible = releases
    .filter((r) => APP_VERSION.test(r.version) && r.published && Date.parse(r.published) >= closedAt && (channel === "nightly" || !r.prerelease))
    .sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  return eligible[0] ?? null;
}

export function fixStatus(report: FixInput, found: Issue | null, releases: Release[], history: InstallHistory | undefined): FixStatus {
  const errorTypes = [...new Set((history?.exceptions ?? []).filter((e) => e.at <= report.at && e.at >= report.at - DAY).map((e) => e.type))];
  if (!report.issueNumber) return { state: "no-issue", version: null, label: "Open · no issue", errorTypes };
  if (!found || found.state === "open") return { state: "open", version: null, label: "Open", errorTypes };
  if (found.reason === "not_planned") return { state: "not-planned", version: null, label: "Closed · not planned", errorTypes };
  const release = found.closedAt ? fixRelease(found.closedAt, report.channel, releases) : null;
  if (!release) return { state: "unreleased", version: null, label: "Fixed · not released yet", errorTypes };
  const fix = release.version;
  const after = (v: string) => Boolean(v) && compareVersions(v, fix) >= 0;
  if (errorTypes.length && history?.exceptions.some((e) => e.at > report.at && after(e.version) && errorTypes.includes(e.type))) {
    return { state: "came-back", version: fix, label: `Came back on ${fix}+`, errorTypes };
  }
  if (errorTypes.length && history?.versions.some(after)) return { state: "not-seen", version: fix, label: `Not seen since ${fix}`, errorTypes };
  return { state: "fixed", version: fix, label: `Fixed in ${fix}`, errorTypes };
}

