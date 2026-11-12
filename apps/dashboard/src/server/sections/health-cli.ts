import { windowFor, type RangeKey } from "../../lib/range";
import { compareVersions } from "../../lib/versions";
import { num, query, str } from "../clickhouse";
import { since } from "../sql";

const CLI = `source = 'ardia-cli'`;
const FAILED = `properties['exit_code'] NOT IN ('', '0')`;
const TYPE = `coalesce(nullIf(JSONExtractString(properties['$exception_types'], 1), ''), nullIf(JSONExtractString(properties['$exception_list'], 1, 'type'), ''), 'Error')`;

export async function healthCli(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const [versions, commands] = await Promise.all([
    query(
      `SELECT if(properties['cli_version'] = '', 'unknown', properties['cli_version']) AS v, uniq(distinct_id),
         countIf(event = 'cli_command'), countIf(event = 'cli_command' AND ${FAILED}), countIf(event = '$exception'),
         quantilesIf(0.5, 0.95)(toFloat64OrZero(properties['total_ms']), event = 'cli_command' AND properties['total_ms'] != '')
       FROM telemetry.events
       WHERE ${CLI} AND event IN ('cli_command', '$exception') AND ${since(w.start)}
       GROUP BY v`,
      signal,
    ),
    query(
      `SELECT if(event = 'cli_command', trimRight(concat(properties['command'], ' ', properties['subcommand'])), concat('exception: ', ${TYPE})) AS what,
         count(), countIf(event = '$exception' OR ${FAILED}), uniq(distinct_id), groupUniqArrayIf(6)(distinct_id, event = '$exception' OR ${FAILED}),
         max(toUnixTimestamp64Milli(timestamp))
       FROM telemetry.events
       WHERE ${CLI} AND event IN ('cli_command', '$exception') AND ${since(w.start)}
       GROUP BY what
       ORDER BY 3 DESC, 2 DESC
       LIMIT 60`,
      signal,
    ),
  ]);
  return {
    versions: versions
      .map((r) => {
        const q = (r[5] as number[]) ?? [];
        const runs = num(r[2]);
        const failed = num(r[3]);
        return { version: str(r[0]), people: num(r[1]), commands: runs, failed, failRate: runs ? failed / runs : null, exceptions: num(r[4]), p50: num(q[0]), p95: num(q[1]) };
      })
      .sort((a, b) => compareVersions(b.version, a.version)),
    commands: commands.map((r) => ({ command: str(r[0]), runs: num(r[1]), failed: num(r[2]), people: num(r[3]), who: ((r[4] as string[]) ?? []).map(str), lastSeen: num(r[5]) })),
  };
}
