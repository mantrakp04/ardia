const SESSION_GAP_MS = 30 * 60_000;
const HOURLY_BEAT_GAP_MS = 65 * 60_000;

export const SLOW_JOURNEYS = [
  { key: "j2_typeable_p95", label: "New tab to typeable", over: 600 },
  { key: "j3_total_p95", label: "Tab switch", over: 2500 },
  { key: "j4_fcp_p95", label: "Navigation to first paint", over: 3000 },
] as const;

export type TimelineEvent = {
  id: string;
  at: number;
  event: string;
  session: string;
  version: string;
  title: string;
  detail: string;
  tone: "neutral" | "bad" | "warn" | "good";
  properties: Record<string, string>;
  mark?: "reported" | "since-report";
};

export type TimelineSession = {
  key: string;
  session: string;
  start: number;
  end: number;
  versions: string[];
  events: TimelineEvent[];
  crashed: boolean;
};

const exceptionType = (p: Record<string, string>) => {
  try {
    const types = JSON.parse(p.$exception_types ?? "[]") as unknown[];
    if (typeof types[0] === "string" && types[0]) return types[0];
  } catch {}
  try {
    const list = JSON.parse(p.$exception_list ?? "[]") as { type?: string }[];
    if (list[0]?.type) return list[0].type;
  } catch {}
  return "Error";
};

const exceptionValue = (p: Record<string, string>) => {
  try {
    const values = JSON.parse(p.$exception_values ?? "[]") as unknown[];
    if (typeof values[0] === "string") return values[0];
  } catch {}
  return "";
};

const ms = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`) : "";
};

export function describeEvent(event: string, p: Record<string, string>): Pick<TimelineEvent, "title" | "detail" | "tone"> {
  switch (event) {
    case "app_launched": {
      const unclean = p.previous_session === "unclean";
      return {
        title: unclean ? "Launched after an unclean exit" : "Launched",
        detail: [p.$app_version, p.chip, p.memory_gb ? `${p.memory_gb} GB` : "", p.rebooted_since === "true" ? "Mac restarted since" : ""].filter(Boolean).join(" · "),
        tone: unclean ? "warn" : "neutral",
      };
    }
    case "app_updated":
      return { title: "Updated", detail: `${p.from_version || "?"} → ${p.$app_version || "?"}`, tone: "good" };
    case "app_session_ended":
      return { title: "Session ended", detail: p.duration_minutes ? `${Math.round(Number(p.duration_minutes))} min` : "", tone: "neutral" };
    case "$exception": {
      const crash = p.source === "native_crash" || p.source === "helper_crash";
      const where = p.source === "helper_crash" ? `${p.crash_process || "helper"} crash` : p.source === "native_crash" ? "App crash" : "Exception";
      return {
        title: `${where}: ${exceptionType(p)}`,
        detail: [p.crash_signal, p.crashed_version && p.crashed_version !== p.$app_version ? `crashed on ${p.crashed_version}` : "", exceptionValue(p).slice(0, 160)].filter(Boolean).join(" · "),
        tone: crash ? "bad" : "warn",
      };
    }
    case "page_process_gone":
      return { title: `Page process gone: ${p.reason || "unknown"}`, detail: [p.visible === "true" ? "visible tab" : "background tab", p.memory_pressure ? `memory ${p.memory_pressure}` : "", p.exit_code ? `exit ${p.exit_code}` : ""].filter(Boolean).join(" · "), tone: "bad" };
    case "perf_journeys": {
      const slow = SLOW_JOURNEYS.filter((j) => Number(p[j.key] ?? 0) > j.over).map((j) => `${j.label} p95 ${ms(p[j.key])}`);
      return { title: "Slow journeys", detail: slow.join(" · "), tone: "warn" };
    }
    case "cli_command": {
      const failed = p.exit_code !== undefined && p.exit_code !== "" && p.exit_code !== "0";
      return {
        title: `ardia ${[p.command, p.subcommand].filter(Boolean).join(" ")}`,
        detail: [failed ? `exit ${p.exit_code}` : "", ms(p.total_ms), p.cli_version].filter(Boolean).join(" · "),
        tone: failed ? "bad" : "neutral",
      };
    }
    case "feedback_submitted":
      return { title: `Report: ${p.title || "untitled"}`, detail: [p.feedback_id || p.id, p.kind, p.app_version || p.cli_version ? `on ${p.app_version || p.cli_version}` : ""].filter(Boolean).join(" · "), tone: "warn" };
    case "cli_feedback":
      return { title: "Agent feedback", detail: (p.text ?? "").slice(0, 160), tone: "warn" };
    case "sharing_turned_on":
      return { title: "Turned sharing on", detail: "", tone: "good" };
    default:
      return { title: event, detail: "", tone: "neutral" };
  }
}

export function markReports(events: TimelineEvent[]): TimelineEvent[] {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  let pending = false;
  for (const e of ordered) {
    if (e.event === "feedback_submitted" || e.event === "cli_feedback") {
      e.mark = "reported";
      pending = true;
    } else if (pending && e.event === "app_updated") {
      e.mark = "since-report";
      pending = false;
    }
  }
  return events;
}

function reachThrough(from: number, to: number, activity: number[]): number {
  let reached = from;
  for (const at of activity) {
    if (at <= reached) continue;
    if (at > to || at - reached > HOURLY_BEAT_GAP_MS) break;
    reached = at;
  }
  return reached;
}

export function groupSessions(events: TimelineEvent[], activity: number[] = []): TimelineSession[] {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const beats = [...activity].sort((a, b) => a - b);
  const sessions: TimelineSession[] = [];
  const byId = new Map<string, TimelineSession>();
  let loose: TimelineSession | null = null;
  for (const e of ordered) {
    let target: TimelineSession;
    if (e.session) {
      target = byId.get(e.session) ?? { key: e.session, session: e.session, start: e.at, end: e.at, versions: [], events: [], crashed: false };
      if (!byId.has(e.session)) {
        byId.set(e.session, target);
        sessions.push(target);
      }
    } else {
      if (!loose || e.at - reachThrough(loose.end, e.at, beats) > SESSION_GAP_MS || (e.event === "app_launched" && loose.events.length > 0)) {
        loose = { key: `gap-${e.at}-${e.id}`, session: "", start: e.at, end: e.at, versions: [], events: [], crashed: false };
        sessions.push(loose);
      }
      target = loose;
    }
    target.events.push(e);
    target.start = Math.min(target.start, e.at);
    target.end = Math.max(target.end, e.at);
    if (e.version && !target.versions.includes(e.version)) target.versions.push(e.version);
    if (e.event === "$exception" && (e.properties.source === "native_crash" || e.properties.source === "helper_crash")) target.crashed = true;
  }
  for (const s of sessions) s.events.reverse();
  return sessions.sort((a, b) => b.end - a.end);
}

