import { windowFor, type RangeKey } from "../../lib/range";
import { num, query, str } from "../clickhouse";
import { since } from "../sql";

export const CLI_FEEDBACK = `event = 'cli_feedback' AND source = 'ardia-cli'`;

function list(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function feedbackCli(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(
    `SELECT uuid, toUnixTimestamp64Milli(timestamp), distinct_id, properties['agent'], properties['cli_version'], properties['$environment'],
       properties['about_command'], properties['recent_commands'], substring(properties['text'], 1, 1200), properties['text_truncated']
     FROM telemetry.events
     WHERE ${CLI_FEEDBACK} AND ${since(w.start)}
     ORDER BY timestamp DESC
     LIMIT 500`,
    signal,
  );
  return rows.map((r) => ({
    id: str(r[0]),
    at: num(r[1]),
    install: str(r[2]),
    agent: str(r[3]) || "ardia",
    version: str(r[4]),
    environment: str(r[5]),
    command: str(r[6]),
    recent: list(str(r[7])),
    text: str(r[8]),
    truncated: str(r[9]) === "true",
  }));
}
