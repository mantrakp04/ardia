import { dateValueMs, REPLAY_FIELDS, type ReplayCondition, type ReplayField, type ReplayMatch, type ReplayOp, type ReplaySort } from "../lib/replay-query.ts";
import type { QueryParams } from "./clickhouse.ts";
import { prop, since } from "./sql.ts";

export const REPLAY_PAGE_SIZE = 50;

export const CUSTOMIZE_EVENT = "demo_customize";
export const DOWNLOAD_EVENT = "download_clicked";

const COLUMN: Record<Exclude<ReplayField, "any_page">, string> = {
  length: "duration_s",
  pages: "pages",
  clicks: "clicks",
  size: "bytes / 1024",
  download: "downloaded",
  customize: "customized",
  device: "device",
  browser: "browser",
  os: "os_name",
  country: "country",
  first_page: "first_url",
  referrer: "referrer",
  started: "start_ms",
};

const NUMBER_OP: Partial<Record<ReplayOp, string>> = { gte: ">=", lte: "<=", gt: ">", lt: "<", eq: "=", neq: "!=" };

const ORDER: Record<ReplaySort, string> = {
  newest: "start_ms DESC",
  longest: "duration_s DESC, start_ms DESC",
  clicks: "clicks DESC, start_ms DESC",
};

const DEVICE_SQL = (type: string, os: string) =>
  `multiIf(${type} = 'Desktop', if(${os} = 'Mac OS X', 'Mac', if(${os} != '', ${os}, 'Desktop')), ${os} = 'iOS', if(${type} = 'Tablet', 'iPad', 'iPhone'), ${os} = 'Android', 'Android', ${os} != '', ${os}, ${type} != '', ${type}, 'Other')`;

const REFERRER_SQL = (domain: string) => `if(${domain} IN ('$direct', ''), 'direct', ${domain})`;

class Params {
  values: QueryParams = {};
  pageMatches: string[] = [];
  private next = 0;
  bind(value: string | number, type: "String" | "Float64" | "Int64") {
    const name = `p${this.next++}`;
    this.values[name] = value;
    return `{${name}:${type}}`;
  }
}

function textMatch(op: ReplayOp, target: string, value: string) {
  return op === "starts_with" ? `startsWith(lower(path(${target})), lower(${value}))` : `positionCaseInsensitiveUTF8(${target}, ${value}) > 0`;
}

function conditionSql(c: ReplayCondition, params: Params): string {
  if (c.field === "any_page") {
    const name = `page_match_${params.pageMatches.length}`;
    params.pageMatches.push(`max(${textMatch(c.op, "properties['$current_url']", params.bind(String(c.value), "String"))}) AS ${name}`);
    return `${name} = ${c.op === "not_contains" ? 0 : 1}`;
  }
  const column = COLUMN[c.field];
  const kind = REPLAY_FIELDS[c.field].kind;
  if (kind === "number") return `${column} ${NUMBER_OP[c.op]} ${params.bind(Number(c.value), "Float64")}`;
  if (kind === "bool") return `${column} = ${c.value === "yes" ? 1 : 0}`;
  if (kind === "date") return `${column} ${c.op === "after" ? ">=" : "<"} ${params.bind(dateValueMs(String(c.value)) ?? 0, "Int64")}`;
  const value = params.bind(String(c.value), "String");
  if (kind === "choice" || (kind === "domain" && (c.op === "is" || c.op === "is_not"))) return `lower(${column}) ${c.op === "is" ? "=" : "!="} lower(${value})`;
  const test = textMatch(c.op, column, value);
  return c.op === "not_contains" ? `NOT (${test})` : test;
}

function whereSql(conditions: ReplayCondition[], match: ReplayMatch, params: Params) {
  if (!conditions.length) return "1";
  return conditions.map((c) => `(${conditionSql(c, params)})`).join(match === "any" ? " OR " : " AND ");
}

const chunkFilter = (from: number) => `event = '$replay_chunk' AND ${since(from)} AND session_id != ''`;
const replaySessions = (from: number) => `session_id IN (SELECT session_id FROM telemetry.events WHERE ${chunkFilter(from)})`;

export function buildReplayList(input: { from: number; conditions: ReplayCondition[]; match: ReplayMatch; sort: ReplaySort; page: number }) {
  const params = new Params();
  const where = whereSql(input.conditions, input.match, params);
  const pageMatches = params.pageMatches.map((sql) => ` ${sql},`).join("");
  const pageMatchNames = params.pageMatches.map((_, i) => ` page_match_${i},`).join("");
  const offset = (Math.max(1, Math.floor(input.page)) - 1) * REPLAY_PAGE_SIZE;
  const sql = `WITH chunks AS (
    SELECT session_id, min(toInt64OrZero(properties['first_timestamp'])) AS start_ms, max(toInt64OrZero(properties['last_timestamp'])) AS end_ms,
      sum(toUInt32OrZero(properties['clicks'])) AS clicks, sum(toUInt64OrZero(properties['bytes'])) AS bytes
    FROM telemetry.events WHERE ${chunkFilter(input.from)}
    GROUP BY session_id
  ), views AS (
    SELECT session_id, count() AS pages, argMin(properties['$current_url'], timestamp) AS first_url,${pageMatches}
      any(${prop("$device_type")}) AS device_type_raw, any(${prop("$os")}) AS os_name, any(${prop("$browser")}) AS browser, any(${prop("$geoip_country_code")}) AS country,
      argMin(${prop("$referring_domain")}, timestamp) AS referrer_domain
    FROM telemetry.events
    WHERE event = '$pageview' AND ${since(input.from)} AND session_id != ''
    GROUP BY session_id
  ), marks AS (
    SELECT session_id, max(event = '${DOWNLOAD_EVENT}') AS downloaded, max(event = '${CUSTOMIZE_EVENT}') AS customized
    FROM telemetry.events
    WHERE event IN ('${DOWNLOAD_EVENT}', '${CUSTOMIZE_EVENT}') AND ${since(input.from)} AND session_id != ''
    GROUP BY session_id
  )
  SELECT session_id, start_ms, duration_s, clicks, bytes, pages, first_url, device, browser, country, downloaded, customized, count() OVER () AS total
  FROM (
    SELECT session_id, start_ms, toInt64(greatest(0, round((end_ms - start_ms) / 1000))) AS duration_s, clicks, bytes, pages, first_url,${pageMatchNames}
      if(pages = 0, 'Unknown', ${DEVICE_SQL("device_type_raw", "os_name")}) AS device, os_name, browser, country, ${REFERRER_SQL("referrer_domain")} AS referrer,
      downloaded, customized
    FROM chunks LEFT JOIN views USING session_id LEFT JOIN marks USING session_id
  )
  WHERE ${where}
  ORDER BY ${ORDER[input.sort]}, session_id
  LIMIT ${REPLAY_PAGE_SIZE} OFFSET ${offset}`;
  return { sql, params: params.values };
}

export function buildReplayOptions(from: number) {
  const device = DEVICE_SQL(prop("$device_type"), prop("$os"));
  return `SELECT topK(40)(${device}), topK(40)(${prop("$browser")}), topK(40)(${prop("$os")}), topK(80)(${prop("$geoip_country_code")}), topK(60)(${REFERRER_SQL(prop("$referring_domain"))})
    FROM telemetry.events
    WHERE event = '$pageview' AND ${since(from)} AND ${replaySessions(from)}`;
}
