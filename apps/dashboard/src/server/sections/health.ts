import { DATA_START_MS, windowFor, type RangeKey } from "../../lib/range";
import { compareVersions } from "../../lib/versions";
import { num, query, str } from "../clickhouse";
import { APP, APP_SOURCE, prop, since } from "../sql";
import { healthVersionRows } from "./health-rows";

const FRAMES = `arrayReverse(JSONExtractArrayRaw(properties['$exception_list'], 1, 'stacktrace', 'frames'))`;
const OWN_FRAMES = `arrayFilter(f -> JSONExtractBool(f, 'in_app'), ${FRAMES})`;
const FRAME_NAME = `f -> if(JSONExtractBool(f, 'resolved'), JSONExtractString(f, 'function'), concat(JSONExtractString(f, 'module'), ' +?'))`;
const FRAME_FULL = `f -> concat(JSONExtractString(f, 'function'), '  ', JSONExtractString(f, 'module'))`;
const MECHANISM = `JSONExtractString(properties['$exception_list'], 1, 'mechanism', 'type')`;
const TYPE = `coalesce(nullIf(JSONExtractString(properties['$exception_list'], 1, 'type'), ''), nullIf(JSONExtractString(properties['$exception_types'], 1), ''), 'Error')`;
const VALUE = `substring(coalesce(nullIf(JSONExtractString(properties['$exception_list'], 1, 'value'), ''), JSONExtractString(properties['$exception_values'], 1)), 1, 200)`;

export async function healthVersions(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const version = `if(${prop("$app_version")} = '', 'unknown', ${prop("$app_version")}) AS v`;
  const [usage, crashes] = await Promise.all([
    query(
      `SELECT v, uniq(distinct_id), countIf(launched), countIf(unclean), uniqIf(distinct_id, unclean)
       FROM (
         SELECT ${version}, distinct_id, false AS launched, false AS unclean
         FROM telemetry.events
         WHERE ${APP} AND ${since(w.start)} AND event != 'app_launched'
         UNION ALL
         SELECT ${version}, distinct_id, properties['previous_session'] IN ('clean', 'unclean') AS launched, properties['previous_session'] = 'unclean' AS unclean
         FROM telemetry.events
         WHERE event = 'app_launched' AND ${APP_SOURCE} AND ${since(w.start)}
       )
       GROUP BY GROUPING SETS ((v), ())`,
      signal,
    ),
    query(
      `SELECT if(properties['crashed_version'] != '', properties['crashed_version'], ${prop("$app_version")}) AS v, ${MECHANISM} = 'native_crash' AS native, ${TYPE} AS type,
         if(native, arrayStringConcat(arraySlice(arrayCompact(arrayMap(${FRAME_NAME}, ${OWN_FRAMES})), 1, 3), ' ← '), ${VALUE}) AS signature,
         count(), countIf(${since(w.start)}), uniq(distinct_id), uniqIf(distinct_id, ${since(w.start)}),
         min(toUnixTimestamp64Milli(timestamp)), max(toUnixTimestamp64Milli(timestamp)),
         any(properties['crash_signal']), any(${VALUE}),
         any(arraySlice(arrayMap(${FRAME_FULL}, ${FRAMES}), 1, 6)), any(arraySlice(arrayMap(${FRAME_FULL}, ${OWN_FRAMES}), 1, 6)),
         groupUniqArrayIf(12)(distinct_id, ${since(w.start)})
       FROM telemetry.events
       WHERE event = '$exception' AND ${APP_SOURCE} AND ${since(DATA_START_MS)} AND ${MECHANISM} != 'helper_crash'
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
    who: ((r[14] as string[]) ?? []).map(str),
  }));

  const key = (g: { native: boolean; type: string; signature: string }) => `${g.native ? "n" : "j"}|${g.type}|${g.signature}`;
  const earliest = new Map<string, string>();
  for (const g of groups) {
    const k = key(g);
    const seen = earliest.get(k);
    if (!seen || compareVersions(g.version, seen) < 0) earliest.set(k, g.version);
  }

  const signatures = new Map<string, { key: string; native: boolean; type: string; signature: string; signal: string; message: string; count: number; people: number; total: number; firstSeen: number; lastSeen: number; firstVersion: string; versions: { version: string; count: number }[]; crashFrames: string[]; ownFrames: string[]; who: string[] }>();
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
      who: [],
    };
    s.count += g.count;
    s.people += g.people;
    s.versions.push({ version: g.version, count: g.count });
    for (const id of g.who) if (s.who.length < 12 && !s.who.includes(id)) s.who.push(id);
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

  const versions = healthVersionRows(
    usage.map((r) => ({ version: str(r[0]), users: num(r[1]), launches: num(r[2]), unclean: num(r[3]), uncleanPeople: num(r[4]) })),
    crashesByVersion,
    jsByVersion,
  );

  return {
    start: w.start,
    users: total ? num(total[1]) : 0,
    launches: total ? num(total[2]) : 0,
    unclean: total ? num(total[3]) : 0,
    versions,
    signatures: [...signatures.values()].map((s) => ({ ...s, versions: s.versions.sort((a, b) => compareVersions(b.version, a.version)) })).sort((a, b) => b.count - a.count),
  };
}
