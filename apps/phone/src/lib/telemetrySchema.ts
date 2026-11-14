export const PHONE_LIB = "ardia-phone-telemetry";
export const PHONE_SERVICE = "ardia-phone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}(-[a-z]+\.\d{1,4})?$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_COUNT = 1_000_000;
const MAX_MS = 600_000;

export type FieldRule =
  | { kind: "const"; value: string | boolean }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "pattern"; pattern: RegExp }
  | { kind: "count" }
  | { kind: "ms" }
  | { kind: "flag" };

export const CONTEXT_FIELDS = {
  $lib: { kind: "const", value: PHONE_LIB },
  $lib_version: { kind: "const", value: "1" },
  $app_name: { kind: "const", value: "Ardia" },
  app: { kind: "const", value: "phone" },
  platform: { kind: "enum", values: ["android", "ios"] },
  $app_version: { kind: "pattern", pattern: VERSION },
  $os: { kind: "enum", values: ["Android", "iOS"] },
  $os_version: { kind: "pattern", pattern: VERSION },
  $environment: { kind: "enum", values: ["dev", "test", "production"] },
  $process_person_profile: { kind: "const", value: false },
  $geoip_disable: { kind: "const", value: true },
  $session_id: { kind: "pattern", pattern: UUID },
} as const satisfies Record<string, FieldRule>;

export const EVENT_FIELDS = {
  sharing_turned_on: { source: { kind: "enum", values: ["settings", "onboarding"] } },
  app_launched: { legacy_import: { kind: "enum", values: ["imported", "skipped", "none"] } },
  perf_launch: { launch_ms: { kind: "ms" }, js_ms: { kind: "ms" } },
  usage_counts: {
    tabs_opened: { kind: "count" },
    searches: { kind: "count" },
    pins_to_mac: { kind: "count" },
    tabs_sent: { kind: "count" },
    page_processes_gone: { kind: "count" },
  },
} as const satisfies Record<string, Record<string, FieldRule>>;

export type PhoneEvent = keyof typeof EVENT_FIELDS;

export type EventProps<E extends PhoneEvent> = { [K in keyof (typeof EVENT_FIELDS)[E]]: (typeof EVENT_FIELDS)[E][K] extends { kind: "enum"; values: readonly (infer V)[] } ? V : (typeof EVENT_FIELDS)[E][K] extends { kind: "flag" } ? boolean : number };

export type PhoneRecord = { uuid: string; event: PhoneEvent; distinct_id: string; timestamp: string; properties: Record<string, string | number | boolean> };

function fieldProblem(rule: FieldRule, value: unknown): string | null {
  switch (rule.kind) {
    case "const":
      return value === rule.value ? null : "not the fixed value";
    case "enum":
      return typeof value === "string" && rule.values.includes(value) ? null : "not one of its values";
    case "pattern":
      return typeof value === "string" && rule.pattern.test(value) ? null : "not in its format";
    case "count":
      return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_COUNT ? null : "not a count";
    case "ms":
      return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_MS ? null : "not a duration";
    case "flag":
      return typeof value === "boolean" ? null : "not a flag";
  }
}

export function recordProblems(record: PhoneRecord): string[] {
  const problems: string[] = [];
  const fields: Record<string, FieldRule> = EVENT_FIELDS[record.event];
  if (!fields) return [`unknown event ${record.event}`];
  if (!UUID.test(record.uuid)) problems.push("uuid");
  if (!UUID.test(record.distinct_id)) problems.push("distinct_id");
  if (!ISO_TIME.test(record.timestamp)) problems.push("timestamp");
  const rules: Record<string, FieldRule> = { ...CONTEXT_FIELDS, ...fields };
  for (const [key, value] of Object.entries(record.properties)) {
    const rule = rules[key];
    if (!rule) problems.push(`${key}: not in the schema`);
    else {
      const problem = fieldProblem(rule, value);
      if (problem) problems.push(`${key}: ${problem}`);
    }
  }
  for (const key of Object.keys(rules)) if (!(key in record.properties)) problems.push(`${key}: missing`);
  return problems;
}

export type DeviceFacts = { platform: "android" | "ios"; appVersion: string; osVersion: string; environment: "dev" | "test" | "production" };

export function eventContext(device: DeviceFacts, sessionId: string): Record<string, string | boolean> {
  return {
    $lib: PHONE_LIB,
    $lib_version: "1",
    $app_name: "Ardia",
    app: "phone",
    platform: device.platform,
    $app_version: device.appVersion,
    $os: device.platform === "ios" ? "iOS" : "Android",
    $os_version: device.osVersion,
    $environment: device.environment,
    $process_person_profile: false,
    $geoip_disable: true,
    $session_id: sessionId,
  };
}

export function buildRecord<E extends PhoneEvent>(
  event: E,
  props: EventProps<E>,
  ids: { uuid: string; installId: string; sessionId: string },
  device: DeviceFacts,
  at: number,
): PhoneRecord {
  return {
    uuid: ids.uuid,
    event,
    distinct_id: ids.installId,
    timestamp: new Date(at).toISOString(),
    properties: { ...eventContext(device, ids.sessionId), ...(props as Record<string, string | number | boolean>) },
  };
}

export function resourceFor(device: DeviceFacts): Record<string, string> {
  return {
    "service.name": PHONE_SERVICE,
    "service.version": device.appVersion,
    "deployment.environment": device.environment === "production" ? "production" : "development",
    "os.type": device.platform,
    "os.version": device.osVersion,
  };
}

export const COUNTED = ["tabs_opened", "searches", "pins_to_mac", "tabs_sent", "page_processes_gone"] as const;

export type Counted = (typeof COUNTED)[number];

export type DailyCounts = { day: string } & Record<Counted, number>;

export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

export const emptyDay = (day: string): DailyCounts => ({ day, tabs_opened: 0, searches: 0, pins_to_mac: 0, tabs_sent: 0, page_processes_gone: 0 });

const anyCounted = (counts: DailyCounts) => COUNTED.some((field) => counts[field] > 0);

export function rollOver(state: DailyCounts | null, today: string): { state: DailyCounts; due: DailyCounts | null } {
  if (!state) return { state: emptyDay(today), due: null };
  if (state.day >= today) return { state, due: null };
  return { state: emptyDay(today), due: anyCounted(state) ? state : null };
}

export function counted(state: DailyCounts | null, field: Counted, today: string): { state: DailyCounts; due: DailyCounts | null } {
  const rolled = rollOver(state, today);
  return { state: { ...rolled.state, [field]: Math.min(MAX_COUNT, rolled.state[field] + 1) }, due: rolled.due };
}

export function usageProps(counts: DailyCounts): EventProps<"usage_counts"> {
  return { tabs_opened: counts.tabs_opened, searches: counts.searches, pins_to_mac: counts.pins_to_mac, tabs_sent: counts.tabs_sent, page_processes_gone: counts.page_processes_gone };
}

export function parseDaily(raw: string | null | undefined): DailyCounts | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DailyCounts>;
    if (typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return null;
    const out = emptyDay(value.day);
    for (const field of COUNTED) {
      const n = value[field];
      out[field] = Number.isSafeInteger(n) && (n as number) >= 0 ? Math.min(MAX_COUNT, n as number) : 0;
    }
    return out;
  } catch {
    return null;
  }
}

export function launchProps(processStart: number | null, jsStart: number, firstFrame: number): EventProps<"perf_launch"> | null {
  if (processStart === null) return null;
  const launch = Math.round(firstFrame - processStart);
  const js = Math.round(jsStart - processStart);
  if (!(launch >= 0 && launch <= MAX_MS) || !(js >= 0 && js <= launch)) return null;
  return { launch_ms: launch, js_ms: js };
}

export const legacyImportOutcome = (marker: string | null, importedVersion: string, skipped: string): EventProps<"app_launched">["legacy_import"] =>
  marker === importedVersion ? "imported" : marker === skipped ? "skipped" : "none";

export function osVersionOf(raw: string | number): string {
  const text = String(raw).trim();
  return VERSION.test(text) ? text : (text.match(/^\d{1,4}(\.\d{1,4}){0,2}/)?.[0] ?? "0");
}

export function appVersionOf(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  return VERSION.test(text) ? text : "0";
}
