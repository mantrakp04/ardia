import { protectedVideoSite } from "../engines/engines";
import { capture, useTelemetry } from "./client";

export type DrmDiagnosticReport = {
  host: string;
  keySystem: string;
  stage: string;
  code: number;
  main: boolean;
  blockedHosts: string[];
};

const MAX_EVENTS = 30;
const MAX_BLOCKED_HOSTS = 8;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/;
const KEY_SYSTEM = /^[a-z0-9.-]{1,64}$/i;
const STAGES = new Set(["access", "accessDenied", "encrypted", "waitingforkey", "error"]);

let sent = 0;
const seen = new Set<string>();

useTelemetry.subscribe((s, prev) => {
  if (!prev.sharing || s.sharing) return;
  sent = 0;
  seen.clear();
});

const hostname = (value: unknown) => (typeof value === "string" && HOSTNAME.test(value) ? value : null);

export function trackDrmDiagnostic(report: DrmDiagnosticReport) {
  const host = hostname(report.host);
  if (!host || !protectedVideoSite(`https://${host}/`)) return;
  const keySystem = typeof report.keySystem === "string" && KEY_SYSTEM.test(report.keySystem) ? report.keySystem : "";
  const stage = STAGES.has(report.stage) ? report.stage : "unknown";
  const code = Number.isSafeInteger(report.code) ? report.code : 0;
  const key = `${host}|${keySystem}|${stage}|${code}|${report.main}`;
  if (seen.has(key) || sent >= MAX_EVENTS) return;
  seen.add(key);
  sent++;
  const blockedHosts = (Array.isArray(report.blockedHosts) ? report.blockedHosts : [])
    .map(hostname)
    .filter((value): value is string => value !== null)
    .slice(0, MAX_BLOCKED_HOSTS);
  capture(
    "protected_media",
    { stage, code, main: report.main === true, blocked_hosts_n: blockedHosts.length },
    { raw: { host, key_system: keySystem, blocked_hosts: blockedHosts } },
  );
}
