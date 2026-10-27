import { DATA_START_MS, windowFor, type RangeKey } from "../../lib/range";
import { compareVersions, isNightly } from "../../lib/versions";
import { num, query, str } from "../clickhouse";
import { APP, APP_SOURCE, prop, since } from "../sql";

const FRAMES = `arrayReverse(JSONExtractArrayRaw(properties['$exception_list'], 1, 'stacktrace', 'frames'))`;
const OWN_FRAMES = `arrayFilter(f -> JSONExtractBool(f, 'in_app'), ${FRAMES})`;
const FRAME_NAME = `f -> if(JSONExtractBool(f, 'resolved'), JSONExtractString(f, 'function'), concat(JSONExtractString(f, 'module'), ' +?'))`;
const FRAME_FULL = `f -> concat(JSONExtractString(f, 'function'), '  ', JSONExtractString(f, 'module'))`;
const MECHANISM = `JSONExtractString(properties['$exception_list'], 1, 'mechanism', 'type')`;
const TYPE = `coalesce(nullIf(JSONExtractString(properties['$exception_list'], 1, 'type'), ''), nullIf(JSONExtractString(properties['$exception_types'], 1), ''), 'Error')`;
const VALUE = `substring(coalesce(nullIf(JSONExtractString(properties['$exception_list'], 1, 'value'), ''), JSONExtractString(properties['$exception_values'], 1)), 1, 200)`;

export async function healthVersions(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const launched = "event = 'app_launched' AND properties['previous_session'] IN ('clean', 'unclean')";
  const unclean = "event = 'app_launched' AND properties['previous_session'] = 'unclean'";
  const [usage, crashes] = await Promise.all([
    query(
      `SELECT if(${prop("$app_version")} = '', 'unknown', ${prop("$app_version")}) AS v, uniq(distinct_id), countIf(${launched}), countIf(${unclean}), uniqIf(distinct_id, ${unclean})
       FROM telemetry.events
       WHERE ${APP} AND ${since(w.start)}
       GROUP BY GROUPING SETS ((v), ())`,
      signal,
    ),
    query(
      `SELECT ${prop("$app_version")} AS v, ${MECHANISM} = 'native_crash' AS native, ${TYPE} AS type,
         if(native, arrayStringConcat(arraySlice(arrayCompact(arrayMap(${FRAME_NAME}, ${OWN_FRAMES})), 1, 3), ' ← '), ${VALUE}) AS signature,
         count(), countIf(${since(w.start)}), uniq(distinct_id), uniqIf(distinct_id, ${since(w.start)}),
         min(toUnixTimestamp64Milli(timestamp)), max(toUnixTimestamp64Milli(timestamp)),
         any(properties['crash_signal']), any(${VALUE}),
         any(arraySlice(arrayMap(${FRAME_FULL}, ${FRAMES}), 1, 6)), any(arraySlice(arrayMap(${FRAME_FULL}, ${OWN_FRAMES}), 1, 6))
       FROM telemetry.events
       WHERE event = '$exception' AND ${APP_SOURCE} AND ${since(DATA_START_MS)}
       GROUP BY v, native, type, signature`,
      signal,
    ),
  ]);

  const total = usage.find((r) => str(r[0]) === "") ?? null;
  const groups = crashes.map((r) => ({
    version: str(r[0]),
    native: num(r[1]) === 1,
    type: str(r[2]),
    signature: str(r[3]) || "(no frames of ours)",
    total: num(r[4]),
    count: num(r[5]),
    totalPeople: num(r[6]),
    people: num(r[7]),
    firstSeen: num(r[8]),
    lastSeen: num(r[9]),
    signal: str(r[10]),
    message: str(r[11]),
    crashFrames: (r[12] as string[]) ?? [],
    ownFrames: (r[13] as string[]) ?? [],
  }));

  const key = (g: { native: boolean; type: string; signature: string }) => `${g.native ? "n" : "j"}|${g.type}|${g.signature}`;
  const earliest = new Map<string, string>();
  for (const g of groups) {
    const k = key(g);
    const seen = earliest.get(k);
    if (!seen || compareVersions(g.version, seen) < 0) earliest.set(k, g.version);
  }

  const signatures = new Map<string, { key: string; native: boolean; type: string; signature: string; signal: string; message: string; count: number; people: number; total: number; firstSeen: number; lastSeen: number; firstVersion: string; versions: { version: string; count: number }[]; crashFrames: string[]; ownFrames: string[] }>();
  for (const g of groups) {
    if (g.count === 0) continue;
    const k = key(g);
    const s = signatures.get(k) ?? {
      key: k,
      native: g.native,
      type: g.type,
      signature: g.signature,
      signal: g.signal,
      message: g.message,
      count: 0,
      people: 0,
      total: 0,
      firstSeen: Number.POSITIVE_INFINITY,
      lastSeen: 0,
      firstVersion: earliest.get(k) ?? g.version,
      versions: [],
      crashFrames: g.crashFrames,
      ownFrames: g.ownFrames,
    };
    s.count += g.count;
    s.people += g.people;
    s.versions.push({ version: g.version, count: g.count });
    s.lastSeen = Math.max(s.lastSeen, g.lastSeen);
    signatures.set(k, s);
  }
  for (const g of groups) {
    const s = signatures.get(key(g));
    if (!s) continue;
    s.total += g.total;
    s.firstSeen = Math.min(s.firstSeen, g.firstSeen);
  }

  const crashesByVersion = new Map<string, number>();
  for (const g of groups) if (g.native) crashesByVersion.set(g.version, (crashesByVersion.get(g.version) ?? 0) + g.count);
  const jsByVersion = new Map<string, number>();
  for (const g of groups) if (!g.native) jsByVersion.set(g.version, (jsByVersion.get(g.version) ?? 0) + g.count);

  const versions = usage
    .filter((r) => str(r[0]) !== "")
    .map((r) => {
      const version = str(r[0]);
      const users = num(r[1]);
      const crashes = crashesByVersion.get(version) ?? 0;
      return {
        version,
        nightly: isNightly(version),
        users,
        launches: num(r[2]),
        unclean: num(r[3]),
        uncleanPeople: num(r[4]),
        uncleanRate: num(r[2]) ? num(r[3]) / num(r[2]) : null,
        crashes,
        jsErrors: jsByVersion.get(version) ?? 0,
        crashesPer100: users ? (100 * crashes) / users : null,
      };
    })
    .sort((a, b) => compareVersions(b.version, a.version));

  return {
    start: w.start,
    users: total ? num(total[1]) : 0,
    launches: total ? num(total[2]) : 0,
    unclean: total ? num(total[3]) : 0,
    versions,
    signatures: [...signatures.values()].map((s) => ({ ...s, versions: s.versions.sort((a, b) => compareVersions(b.version, a.version)) })).sort((a, b) => b.count - a.count),
  };
}
