export const STATUSES = ["pass", "fail", "manual"];

export function scenarioStatus({ checks = [], error = null }) {
  if (error || checks.some((c) => c.status === "fail")) return "fail";
  if (!checks.length) return "fail";
  if (checks.some((c) => c.status === "manual")) return "manual";
  return "pass";
}

export function summarizeScenario(scenario, record) {
  const checks = record.checks ?? [];
  const status = scenarioStatus(record);
  return {
    issue: scenario.issue,
    finding: scenario.id,
    title: scenario.title,
    status,
    automated: {
      pass: checks.filter((c) => c.status === "pass").length,
      fail: checks.filter((c) => c.status === "fail").length,
    },
    manual: checks.filter((c) => c.status === "manual").map(({ name, steps, reason }) => ({ name, steps, reason })),
    checks: checks.map(({ steps: _, ...check }) => check),
    error: record.error ?? null,
    durationMs: record.durationMs ?? null,
    evidence: record.evidence ?? null,
    scratch: record.keptScratch ?? null,
  };
}

export function buildReport({ executable, uiDir, startedAt, finishedAt, results, environment = {} }) {
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, results.filter((r) => r.status === status).map((r) => r.issue)]));
  return {
    suite: "ardia-linux-native-acceptance",
    executable,
    uiDir: uiDir ?? null,
    startedAt,
    finishedAt,
    environment,
    summary: byStatus,
    closable: byStatus.pass,
    results,
  };
}

export function exitCode(report) {
  return report.summary.fail.length ? 1 : 0;
}

export function formatLine(result) {
  const manual = result.manual.length ? `, ${result.manual.length} manual` : "";
  return `#${result.issue} ${result.finding} ${result.status.toUpperCase()} (${result.automated.pass} passed, ${result.automated.fail} failed${manual})${result.error ? `: ${result.error}` : ""}`;
}
