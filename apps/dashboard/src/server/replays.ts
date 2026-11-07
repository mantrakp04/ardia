import { createGunzip } from "node:zlib";
import { windowFor, type RangeKey } from "../lib/range";
import { num, query, str } from "./clickhouse";
import { serverEnv } from "./env";
import type { ReplayCondition, ReplayMatch, ReplaySort } from "../lib/replay-query";
import { buildReplayList, buildReplayOptions, CUSTOMIZE_EVENT, DOWNLOAD_EVENT, REPLAY_PAGE_SIZE } from "./replay-sql";
import { prop, since } from "./sql";

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEPT_DAYS = 30;
const DAY = 86_400_000;

export type ReplayFilters = {
  range: RangeKey;
  page: number;
  conditions: ReplayCondition[];
  match: ReplayMatch;
  sort: ReplaySort;
};

const deviceName = (type: string, os: string) => {
  if (type === "Desktop") return os === "Mac OS X" ? "Mac" : os || "Desktop";
  if (os === "iOS") return type === "Tablet" ? "iPad" : "iPhone";
  if (os === "Android") return "Android";
  return os || type || "Other";
};

function replayStart(range: RangeKey) {
  const w = windowFor(range);
  const keptFrom = Math.floor((w.end - KEPT_DAYS * DAY) / DAY) * DAY;
  return Math.max(w.start, keptFrom);
}

const choices = (value: unknown) => ((value as unknown[] | undefined) ?? []).map(str).filter(Boolean);

export async function listReplays(filters: ReplayFilters, signal?: AbortSignal): Promise<ReplayList> {
  const from = replayStart(filters.range);
  const list = buildReplayList({ from, conditions: filters.conditions, match: filters.match, sort: filters.sort, page: filters.page });
  const [rows, [options]] = await Promise.all([query(list.sql, signal, undefined, list.params), query(buildReplayOptions(from), signal)]);
  if (!rows.length && filters.page > 1) return listReplays({ ...filters, page: 1 }, signal);
  const total = rows.length ? num(rows[0]!.at(-1)) : 0;
  return {
    from,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / REPLAY_PAGE_SIZE)),
    pageSize: REPLAY_PAGE_SIZE,
    options: {
      device: [...new Set([...choices(options?.[0]), "Unknown"])],
      browser: choices(options?.[1]),
      os: choices(options?.[2]),
      country: choices(options?.[3]),
      referrer: choices(options?.[4]),
    },
    rows: rows.map((r) => ({
      id: str(r[0]),
      start: num(r[1]),
      durationS: num(r[2]),
      clicks: num(r[3]),
      bytes: num(r[4]),
      pages: num(r[5]),
      firstUrl: str(r[6]),
      device: str(r[7]),
      browser: str(r[8]),
      country: str(r[9]),
      downloaded: num(r[10]) === 1,
      customized: num(r[11]) === 1,
    })),
  };
}

export type ReplayRow = { id: string; start: number; durationS: number; clicks: number; bytes: number; pages: number; firstUrl: string; device: string; browser: string; country: string; downloaded: boolean; customized: boolean };
export type ReplayList = {
  from: number;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  options: { device: string[]; browser: string[]; os: string[]; country: string[]; referrer: string[] };
  rows: ReplayRow[];
};

function replaysBase() {
  const url = serverEnv("REPLAYS_URL") ?? (serverEnv("REPLAYS_HOST") ? `http://${serverEnv("REPLAYS_HOST")}:8888/buckets/replays/` : null);
  if (!url) throw new Error("Replay storage is not configured: set REPLAYS_URL or REPLAYS_HOST");
  return url.endsWith("/") ? url : `${url}/`;
}

function replayHeaders(): Record<string, string> {
  const token = serverEnv("REPLAYS_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TIMELINE_EVENTS = ["$pageview", "$autocapture", "$rageclick", "$dead_click", "$exception", DOWNLOAD_EVENT, CUSTOMIZE_EVENT, "github_clicked", "screenshot_opened", "release_notes_viewed", "send_to_mac_clicked", "notify_clicked"];
const SESSION_CACHE = { freshMs: 60_000, keepMs: 5 * 60_000 };
const FETCH_TIMEOUT_MS = 10_000;
const DEADLINE_MS = 30_000;
const MAX_CHUNK_COMPRESSED = 4 * 1024 * 1024;
const MAX_CHUNK_DECOMPRESSED = 32 * 1024 * 1024;
const MAX_SESSION_BYTES = 150 * 1024 * 1024;
const MAX_SESSION_EVENTS = 400_000;

class TooLarge extends Error {}

async function readCapped(res: Response, cap: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel();
    throw new TooLarge();
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new TooLarge();
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

function gunzipCapped(input: Buffer, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = createGunzip();
    const parts: Buffer[] = [];
    let total = 0;
    stream.on("data", (part: Buffer) => {
      total += part.length;
      if (total > cap) {
        stream.destroy();
        reject(new TooLarge());
        return;
      }
      parts.push(part);
    });
    stream.on("end", () => resolve(Buffer.concat(parts)));
    stream.on("error", reject);
    stream.end(input);
  });
}

async function loadChunks(sessionId: string, days: string[], signal: AbortSignal) {
  const base = replaysBase();
  const headers = replayHeaders();
  const get = async (url: string, accept?: string) => {
    try {
      return await fetch(url, { headers: accept ? { ...headers, Accept: accept } : headers, signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
    } catch (error) {
      if (signal.aborted) throw new Error("Loading the replay took too long and was stopped.");
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`Replay storage unreachable (${cause?.code ?? cause?.message ?? (error as Error).message})`);
    }
  };

  const files = new Map<number, { day: string; name: string; gz: boolean }>();
  for (const day of days) {
    const listing = await get(`${base}${day}/${sessionId}/?limit=1000`, "application/json");
    if (listing.status === 404) continue;
    if (!listing.ok) throw new Error(`Replay storage: ${listing.status}`);
    const entries = ((await listing.json()) as { Entries?: { FullPath: string }[] | null }).Entries ?? [];
    for (const entry of entries) {
      const match = /^(\d+)\.json(\.gz)?$/.exec(entry.FullPath.split("/").pop() ?? "");
      if (match && !files.has(Number(match[1]))) files.set(Number(match[1]), { day, name: match[0], gz: Boolean(match[2]) });
    }
  }

  const ordered = [...files].sort((a, b) => a[0] - b[0]);
  const events: { timestamp: number }[] = [];
  let bytes = 0;
  let stoppedAt: number | null = null;
  for (const [seq, file] of ordered) {
    const res = await get(`${base}${file.day}/${sessionId}/${file.name}`);
    if (!res.ok) throw new Error(`Replay storage: ${res.status} for chunk ${seq}`);
    let body: Buffer;
    try {
      const raw = await readCapped(res, MAX_CHUNK_COMPRESSED);
      if (!file.gz && raw.length > MAX_CHUNK_DECOMPRESSED) throw new TooLarge();
      body = file.gz ? await gunzipCapped(raw, MAX_CHUNK_DECOMPRESSED) : raw;
    } catch (error) {
      if (error instanceof TooLarge) {
        stoppedAt = seq;
        break;
      }
      throw error;
    }
    if (bytes + body.length > MAX_SESSION_BYTES) {
      stoppedAt = seq;
      break;
    }
    const chunk = (JSON.parse(body.toString("utf8")) as { events?: { timestamp: number }[] }).events ?? [];
    if (events.length + chunk.length > MAX_SESSION_EVENTS) {
      stoppedAt = seq;
      break;
    }
    bytes += body.length;
    for (const event of chunk) events.push(event);
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return { events, chunks: ordered.length, loadedChunks: stoppedAt === null ? ordered.length : ordered.findIndex(([seq]) => seq === stoppedAt), truncated: stoppedAt !== null };
}

export async function getReplay(sessionId: string, signal?: AbortSignal) {
  if (!SESSION_ID.test(sessionId)) throw new Error("Not a session id");
  const local = new AbortController();
  const bounded = AbortSignal.any([local.signal, AbortSignal.timeout(DEADLINE_MS), ...(signal ? [signal] : [])]);
  try {
    const keptFrom = Math.floor((Date.now() - (KEPT_DAYS + 1) * DAY) / DAY) * DAY;
    const [meta] = await query(
      `SELECT groupUniqArray(toString(toDate(timestamp))), min(toInt64OrZero(properties['first_timestamp'])), max(toInt64OrZero(properties['last_timestamp'])), count(),
         sum(toUInt32OrZero(properties['clicks'])), sum(toUInt64OrZero(properties['bytes']))
       FROM telemetry.events WHERE event = '$replay_chunk' AND ${since(keptFrom)} AND session_id = '${sessionId}'`,
      bounded,
      SESSION_CACHE,
    );
    const days = ((meta?.[0] as string[] | undefined) ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (!days.length) return { found: false as const, sessionId };

    const firstDay = Date.parse(`${days[0]}T00:00:00Z`);
    const lastDay = Date.parse(`${days.at(-1)}T00:00:00Z`);
    const dayList = [...new Set([...days, new Date(lastDay + DAY).toISOString().slice(0, 10)])];

    const [timelineRows, loaded] = await Promise.all([
      query(
        `SELECT toUnixTimestamp64Milli(timestamp), event, properties['$current_url'], properties['$el_text'], properties['$event_type'],
           properties['$exception_values'], properties['location'], ${prop("$device_type")}, ${prop("$os")}, ${prop("$browser")}, ${prop("$geoip_country_code")},
           properties['$referring_domain'], properties['$screen_width'], properties['$screen_height']
         FROM telemetry.events
         WHERE event IN (${TIMELINE_EVENTS.map((e) => `'${e}'`).join(", ")}) AND ${since(firstDay - DAY)} AND session_id = '${sessionId}'
         ORDER BY timestamp LIMIT 2000`,
        bounded,
        SESSION_CACHE,
      ),
      loadChunks(sessionId, dayList, bounded),
    ]);

    const first = timelineRows.find((r) => str(r[1]) === "$pageview");
    const events = loaded.events;
    const shownMinutes = events.length > 1 ? Math.max(1, Math.round((events.at(-1)!.timestamp - events[0]!.timestamp) / 60_000)) : 0;
    return {
      found: events.length > 0 || loaded.truncated,
      sessionId,
      start: num(meta![1]),
      end: num(meta![2]),
      chunks: loaded.chunks,
      clicks: num(meta![4]),
      bytes: num(meta![5]),
      device: first ? deviceName(str(first[7]), str(first[8])) : "Unknown",
      browser: first ? str(first[9]) : "",
      country: first ? str(first[10]) : "",
      referrer: first ? str(first[11]) : "",
      screen: first && str(first[12]) ? `${str(first[12])}×${str(first[13])}` : "",
      truncated: loaded.truncated ? `This replay is too large to load whole, so it shows the first ${shownMinutes} min (${loaded.loadedChunks} of ${loaded.chunks} chunks).` : null,
      timeline: timelineRows.map((r) => ({
        at: num(r[0]),
        event: str(r[1]),
        url: str(r[2]),
        text: str(r[3]).slice(0, 120),
        kind: str(r[4]),
        message: str(r[5]).slice(0, 200),
        location: str(r[6]),
      })),
      events: JSON.stringify(events),
    };
  } catch (error) {
    if (bounded.aborted && !signal?.aborted) throw new Error("Loading the replay took longer than 30 s and was stopped.");
    throw error;
  } finally {
    local.abort();
  }
}
