import { VERSION } from "../../data/release";
import {
  DEV_OPT_IN_KEY,
  FLUSH_MS,
  LEGACY_VISITOR_ID_KEY,
  LOGS_PATH,
  PRODUCTION_HOSTS,
  SCROLL_SAMPLE_MS,
  SERVICE_NAME,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  WEB_LIB,
  type TelemetryEvent,
} from "../../data/telemetry";
import { KEYS, read, readJSON, write } from "../storage";
import { parseUserAgent } from "./ua";

export type Value = string | number | boolean | null | undefined | object;
export type Props = Record<string, Value>;
interface CaptureOptions {
  send_instantly?: boolean;
  timestamp?: number;
  uuid?: string;
}

const LIB_VERSION = "1.0.0";

const production = PRODUCTION_HOSTS.includes(location.hostname);
export const enabled = production || read(DEV_OPT_IN_KEY) === "dev";
const environment = production ? "production" : "development";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function uuidv7(ms = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 5, t = ms; i >= 0; i--, t = Math.floor(t / 256)) b[i] = t % 256;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function legacyVisitorId(): string | null {
  const pick = (json: string | null | undefined) => {
    try {
      const id = json ? (JSON.parse(json) as { distinct_id?: unknown }).distinct_id : null;
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  };
  const fromStorage = pick(read(LEGACY_VISITOR_ID_KEY));
  if (fromStorage) return fromStorage;
  try {
    const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${LEGACY_VISITOR_ID_KEY}=`));
    return pick(cookie && decodeURIComponent(cookie.slice(LEGACY_VISITOR_ID_KEY.length + 1)));
  } catch {
    return null;
  }
}

function visitorId(): string {
  const stored = read(KEYS.visitorId);
  if (stored) return stored;
  const id = legacyVisitorId() ?? uuidv7();
  write(KEYS.visitorId, id);
  return id;
}

export const distinctId = visitorId();

export const windowId: string = read(KEYS.window, "session") ?? uuidv7();
write(KEYS.window, windowId, "session");

const CAMPAIGN_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "gad_source", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id",
  "mc_cid", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx",
];

function campaign(): Props {
  const out: Props = {};
  const params = new URLSearchParams(location.search);
  for (const key of CAMPAIGN_PARAMS) {
    const v = params.get(key);
    if (v !== null) out[key] = v;
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const referrer = document.referrer || "$direct";
const referringDomain = (document.referrer && hostOf(document.referrer)) || "$direct";

function searchEngine(host: string): string | null {
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/(^|\.)bing\.com$/.test(host)) return "bing";
  if (/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.co(m|\.[a-z]+)$/.test(host)) return "yahoo";
  if (/(^|\.)duckduckgo\.com$/.test(host)) return "duckduckgo";
  return null;
}

const device = parseUserAgent(navigator.userAgent, "brave" in navigator);
const language = navigator.language || "";

const { device: ardiaDevice, os: ardiaOs } = document.documentElement.dataset;

const constant: Props = {
  $lib: WEB_LIB,
  $lib_version: LIB_VERSION,
  ...device,
  $raw_user_agent: navigator.userAgent,
  $browser_language: language,
  $browser_language_prefix: language.split("-")[0] || null,
  $screen_width: screen.width,
  $screen_height: screen.height,
  $timezone: (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  })(),
  $timezone_offset: new Date().getTimezoneOffset(),
  $referrer: referrer,
  $referring_domain: referringDomain,
  $search_engine: referringDomain === "$direct" ? null : searchEngine(referringDomain),
  environment,
  release_version: VERSION,
  ardia_device: ardiaDevice,
  ardia_os: ardiaOs,
};

if (device.$os === "Android" && !device.$device_model) {
  const cached = read(KEYS.deviceModel, "session");
  if (cached) constant.$device_model = cached;
  else
    (navigator as Navigator & { userAgentData?: { getHighEntropyValues?(h: string[]): Promise<{ model?: string }> } }).userAgentData
      ?.getHighEntropyValues?.(["model"])
      .then(({ model }) => {
        if (!model) return;
        constant.$device_model = model;
        write(KEYS.deviceModel, model, "session");
      })
      .catch(() => {});
}

const registered: Props = {};
export function register(props: Props) {
  Object.assign(registered, props);
}

const cachedFlags = readJSON<{ id: string; props: Props }>(KEYS.flags);
if (cachedFlags?.id === distinctId && cachedFlags.props) register(cachedFlags.props);

interface Session {
  id: string;
  start: number;
  last: number;
  entry: Props;
}

function entryProps(): Props {
  const out: Props = {
    $session_entry_url: location.href,
    $session_entry_host: location.host,
    $session_entry_pathname: location.pathname,
    $session_entry_referrer: referrer,
    $session_entry_referring_domain: referringDomain,
  };
  for (const [k, v] of Object.entries(campaign())) out[`$session_entry_${k}`] = v;
  return out;
}

let session: Session | null = null;
const sessionListeners: ((id: string, previous: string) => void)[] = [];

export function onSessionChange(fn: (id: string, previous: string) => void) {
  sessionListeners.push(fn);
}

function touchSession(now = Date.now()): Session {
  const stored = readJSON<Session>(KEYS.session);
  let s = stored && typeof stored.id === "string" ? stored : session;
  const lapsed = !s || now - s.last > SESSION_IDLE_MS || now - s.start > SESSION_MAX_MS;
  const previous = session?.id;
  if (lapsed) s = { id: uuidv7(now), start: now, last: now, entry: entryProps() };
  else s!.last = Math.max(s!.last, now);
  session = s!;
  write(KEYS.session, JSON.stringify(session));
  if (previous && previous !== session.id) for (const fn of sessionListeners) fn(session.id, previous);
  return session;
}

export const sessionId = () => (session ?? touchSession()).id;
export const sessionStart = () => (session ?? touchSession()).start;

let lastTouch = 0;
const activity = () => {
  const now = Date.now();
  if (now - lastTouch < 5000) return;
  lastTouch = now;
  touchSession(now);
};

interface AnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}
interface KeyValue {
  key: string;
  value: AnyValue;
}
interface LogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: AnyValue;
  attributes: KeyValue[];
}

function toValue(v: Value): AnyValue | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Number.isSafeInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  try {
    return { stringValue: JSON.stringify(v) };
  } catch {
    return null;
  }
}

function attributes(props: Props): KeyValue[] {
  const out: KeyValue[] = [];
  for (const [key, v] of Object.entries(props)) {
    const value = toValue(v);
    if (value) out.push({ key, value });
  }
  return out;
}

const nanos = (ms: number) => `${Math.round(ms)}000000`;

const resource = {
  attributes: attributes({
    "service.name": SERVICE_NAME,
    "service.version": VERSION,
    "deployment.environment": environment,
  }),
};

type Scope = "ardia.analytics" | "ardia.site";
interface Queued {
  scope: Scope;
  record: LogRecord;
  size: number;
  retried?: boolean;
}

const queue: Queued[] = [];
let timer = 0;
const MAX_BODY = 60_000;

function body(items: Queued[]): string {
  const scopes = new Map<Scope, LogRecord[]>();
  for (const i of items) {
    const list = scopes.get(i.scope) ?? [];
    list.push(i.record);
    scopes.set(i.scope, list);
  }
  return JSON.stringify({
    resourceLogs: [
      { resource, scopeLogs: [...scopes].map(([name, logRecords]) => ({ scope: { name }, logRecords })) },
    ],
  });
}

function post(items: Queued[], beacon: boolean) {
  const payload = body(items);
  if (beacon && typeof navigator.sendBeacon === "function") {
    try {
      if (navigator.sendBeacon(LOGS_PATH, new Blob([payload], { type: "application/json" }))) return;
    } catch {}
  }
  const retry = () => {
    const again = items.filter((i) => !i.retried);
    for (const i of again) i.retried = true;
    if (again.length) {
      queue.unshift(...again);
      schedule();
    }
  };
  fetch(LOGS_PATH, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: payload.length < MAX_BODY,
    credentials: "omit",
  })
    .then((r) => {
      if (r.status === 429 || r.status >= 500) retry();
    })
    .catch(retry);
}

function flush(beacon = false) {
  clearTimeout(timer);
  timer = 0;
  while (queue.length) {
    const batch: Queued[] = [];
    let size = 200;
    while (queue.length && (batch.length === 0 || size + queue[0].size < MAX_BODY)) {
      const next = queue.shift()!;
      size += next.size;
      batch.push(next);
    }
    post(batch, beacon);
  }
}

function schedule() {
  if (!timer && queue.length) timer = window.setTimeout(() => flush(), FLUSH_MS);
}

function enqueue(scope: Scope, record: LogRecord, instantly = false) {
  queue.push({ scope, record, size: JSON.stringify(record).length });
  if (instantly || queue.length >= 100) flush(instantly);
  else schedule();
}

let pageviewId: string | undefined;

export function capture(event: TelemetryEvent, props: Props = {}, options: CaptureOptions = {}): string | undefined {
  if (!enabled) return;
  try {
    const now = Date.now();
    const s = touchSession(now);
    const uuid = options.uuid ?? uuidv7(now);
    const all: Props = {
      ...constant,
      $current_url: location.href,
      $host: location.host,
      $pathname: location.pathname,
      $viewport_width: window.innerWidth,
      $viewport_height: window.innerHeight,
      ...campaign(),
      ...s.entry,
      ...registered,
      $session_id: s.id,
      $window_id: windowId,
      $pageview_id: pageviewId,
      ...props,
    };
    enqueue(
      "ardia.analytics",
      {
        timeUnixNano: nanos(options.timestamp ?? now),
        severityNumber: 9,
        severityText: "INFO",
        body: { stringValue: event },
        attributes: [
          { key: "event", value: { stringValue: event } },
          { key: "uuid", value: { stringValue: uuid } },
          { key: "distinct_id", value: { stringValue: distinctId } },
          ...attributes(all),
        ],
      },
      options.send_instantly,
    );
    return uuid;
  } catch {
    return;
  }
}

const SEVERITY = { warn: [13, "WARN"], error: [17, "ERROR"] } as const;

export function log(level: keyof typeof SEVERITY, message: string, props: Props = {}) {
  if (!enabled) return;
  try {
    const [severityNumber, severityText] = SEVERITY[level];
    enqueue("ardia.site", {
      timeUnixNano: nanos(Date.now()),
      severityNumber,
      severityText,
      body: { stringValue: message },
      attributes: attributes({
        distinct_id: distinctId,
        $session_id: session?.id,
        $window_id: windowId,
        $current_url: location.href,
        $pathname: location.pathname,
        $browser: device.$browser,
        $browser_version: device.$browser_version,
        $os: device.$os,
        $device_type: device.$device_type,
        release_version: VERSION,
        ...props,
      }),
    });
  } catch {}
}

const hideHooks: (() => void)[] = [];
export function onHide(fn: () => void) {
  hideHooks.push(fn);
}

let lastScroll = 0;
let maxScroll = 0;
let lastContent = 0;
let maxContent = 0;
let measuring = 0;
function measure() {
  measuring = 0;
  const el = document.scrollingElement ?? document.documentElement;
  lastScroll = Math.round(el.scrollTop);
  lastContent = Math.round(el.scrollTop + el.clientHeight);
  maxScroll = Math.max(maxScroll, lastScroll);
  maxContent = Math.max(maxContent, lastContent);
}

const ratio = (part: number, whole: number) => (whole <= 0 ? 1 : Math.min(1, Math.max(0, part / whole)));

let pageviewAt = 0;
let pageviewPath = "";
let left = false;
function pageleave() {
  if (left || !pageviewId) return;
  left = true;
  measure();
  const el = document.scrollingElement ?? document.documentElement;
  const contentHeight = el.scrollHeight;
  const scrollHeight = Math.max(0, contentHeight - el.clientHeight);
  capture("$pageleave", {
    $prev_pageview_id: pageviewId,
    $prev_pageview_pathname: pageviewPath,
    $prev_pageview_duration: (Date.now() - pageviewAt) / 1000,
    $prev_pageview_last_scroll: lastScroll,
    $prev_pageview_last_scroll_percentage: ratio(lastScroll, scrollHeight),
    $prev_pageview_max_scroll: maxScroll,
    $prev_pageview_max_scroll_percentage: ratio(maxScroll, scrollHeight),
    $prev_pageview_last_content: lastContent,
    $prev_pageview_last_content_percentage: ratio(lastContent, contentHeight),
    $prev_pageview_max_content: maxContent,
    $prev_pageview_max_content_percentage: ratio(maxContent, contentHeight),
  });
}

function hidden(unloading: boolean) {
  for (const fn of hideHooks) {
    try {
      fn();
    } catch {}
  }
  if (unloading) pageleave();
  flush(true);
}

if (enabled) {
  touchSession();
  pageviewId = uuidv7();
  pageviewAt = Date.now();
  pageviewPath = location.pathname;
  capture("$pageview", { title: document.title }, { uuid: pageviewId });
  measure();

  addEventListener("scroll", () => (measuring ||= window.setTimeout(measure, SCROLL_SAMPLE_MS)), { passive: true });
  for (const type of ["click", "keydown", "scroll", "touchstart", "mousemove"])
    addEventListener(type, activity, { passive: true, capture: true });
  addEventListener("pagehide", () => hidden(true));
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hidden(false);
  });
  addEventListener("pageshow", (e) => {
    if (e.persisted) left = false;
  });
}
