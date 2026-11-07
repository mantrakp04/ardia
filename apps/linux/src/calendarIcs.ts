export type IcsProperty = { name: string; params: Record<string, string>; value: string };
export type IcsComponent = { name: string; properties: IcsProperty[]; components: IcsComponent[] };
export type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };
export type IcsTime = { wall: Wall; kind: "date" | "utc" | "floating" | "zoned"; tzid?: string };

const DAY_MS = 86_400_000;
const ZONE_SLACK_MS = 15 * 3_600_000;
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MAX_PERIODS = 50_000;
const MAX_INSTANCES = 5_000;
const MAX_DEPTH = 16;

export function parseIcs(text: string): IcsComponent[] {
  const root: IcsComponent = { name: "", properties: [], components: [] };
  const stack = [root];
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const property = parseLine(line);
    if (!property) continue;
    const top = stack[stack.length - 1]!;
    if (property.name === "BEGIN") {
      if (stack.length > MAX_DEPTH) throw new Error("iCalendar components are nested too deeply");
      const component: IcsComponent = { name: property.value.toUpperCase(), properties: [], components: [] };
      top.components.push(component);
      stack.push(component);
    } else if (property.name === "END") {
      if (stack.length > 1 && top.name === property.value.toUpperCase()) stack.pop();
    } else {
      top.properties.push(property);
    }
  }
  return root.components;
}

function parseLine(line: string): IcsProperty | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = splitUnquoted(line.slice(0, colon), ";");
  const name = head[0]!.trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of head.slice(1)) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    params[part.slice(0, equals).trim().toUpperCase()] = part.slice(equals + 1).replace(/"/g, "");
  }
  return { name, params, value: line.slice(colon + 1) };
}

function splitUnquoted(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === separator && !quoted) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

export const property = (component: IcsComponent, name: string) => component.properties.find((p) => p.name === name);
export const properties = (component: IcsComponent, name: string) => component.properties.filter((p) => p.name === name);

export function parseTime(value: string, params: Record<string, string> = {}): IcsTime | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const wall: Wall = {
    year: +match[1]!, month: +match[2]!, day: +match[3]!,
    hour: match[4] ? +match[4] : 0, minute: match[5] ? +match[5] : 0, second: match[6] ? Math.min(59, +match[6]) : 0,
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > daysInMonth(wall.year, wall.month)) return null;
  if (!match[4] || params.VALUE === "DATE") return { wall, kind: "date" };
  if (match[7]) return { wall, kind: "utc" };
  if (params.TZID) return { wall, kind: "zoned", tzid: params.TZID };
  return { wall, kind: "floating" };
}

export function parseDuration(value: string): { days: number; ms: number } | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const days = (+(match[2] ?? 0) * 7 + +(match[3] ?? 0)) * sign;
  const ms = ((+(match[4] ?? 0) * 60 + +(match[5] ?? 0)) * 60 + +(match[6] ?? 0)) * 1000 * sign;
  return { days, ms };
}

function utcMs(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): number {
  if (year < 0 || year >= 100) return Date.UTC(year, monthIndex, day, hour, minute, second);
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function localMs(year: number, monthIndex: number, day: number, hour: number, minute: number, second: number): number {
  if (year < 0 || year >= 100) return new Date(year, monthIndex, day, hour, minute, second).getTime();
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, monthIndex, day);
  date.setHours(hour, minute, second, 0);
  return date.getTime();
}

export const wallMs = (w: Wall) => utcMs(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
export const daysInMonth = (year: number, month: number) => new Date(utcMs(year, month, 0)).getUTCDate();
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const dayNumber = (year: number, month: number, day: number) => utcMs(year, month - 1, day) / DAY_MS;
const weekday = (dn: number) => (new Date(dn * DAY_MS).getUTCDay() + 6) % 7;

export function wallFromMs(ms: number): Wall {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}

export const addDays = (w: Wall, days: number): Wall => wallFromMs(wallMs(w) + days * DAY_MS);
const compareWalls = (a: Wall, b: Wall) => wallMs(a) - wallMs(b);
const dateKey = (w: Wall) => `${w.year}-${w.month}-${w.day}`;

export type Zone = { toUtc(wall: Wall): number };

export const UTC_ZONE: Zone = { toUtc: wallMs };
export const LOCAL_ZONE: Zone = { toUtc: (w) => localMs(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) };

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(name: string): Intl.DateTimeFormat | null {
  if (!formatters.has(name)) {
    try {
      formatters.set(name, new Intl.DateTimeFormat("en-US", {
        timeZone: name, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
      }));
    } catch {
      formatters.set(name, null);
    }
  }
  return formatters.get(name)!;
}

function offsetZone(offsetAt: (utc: number) => number): Zone {
  return {
    toUtc(wall) {
      const local = wallMs(wall);
      const first = local - offsetAt(local);
      const second = local - offsetAt(first);
      return offsetAt(second) === offsetAt(first) ? second : Math.max(first, second);
    },
  };
}

export function ianaZone(name: string): Zone | null {
  const format = formatter(name);
  if (!format) return null;
  return offsetZone((utc) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    const local = utcMs(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
    return local - Math.floor(utc / 1000) * 1000;
  });
}

export function ianaName(tzid: string): string | null {
  const segments = tzid.replace(/^\/+/, "").split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const candidate = segments.slice(i).join("/");
    if (candidate && (i === 0 || candidate.includes("/") || candidate === "UTC") && formatter(candidate)) return candidate;
  }
  return null;
}

function parseOffset(value: string | undefined): number | null {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value?.trim() ?? "");
  if (!match) return null;
  return (match[1] === "-" ? -1 : 1) * ((+match[2]! * 60 + +match[3]!) * 60 + +(match[4] ?? 0)) * 1000;
}

export function vtimezoneZone(component: IcsComponent): Zone | null {
  const onsets: { utc: number; offset: number }[] = [];
  let earliest: { utc: number; before: number } | null = null;
  for (const observance of component.components) {
    if (observance.name !== "STANDARD" && observance.name !== "DAYLIGHT") continue;
    const from = parseOffset(property(observance, "TZOFFSETFROM")?.value);
    const to = parseOffset(property(observance, "TZOFFSETTO")?.value);
    const start = property(observance, "DTSTART");
    const startTime = start && parseTime(start.value);
    if (from === null || to === null || !startTime) continue;
    const walls: Wall[] = [startTime.wall];
    const rule = property(observance, "RRULE");
    if (rule) {
      const parsed = parseRule(rule.value);
      if (parsed) {
        const limit: Wall = { year: 2200, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
        walls.push(...expandRule(startTime.wall, false, parsed, (w) => compareWalls(w, limit) > 0, (w) => untilPassed(parsed, w, (x) => wallMs(x) - from)).slice(1));
      }
    }
    for (const rdate of properties(observance, "RDATE")) {
      for (const part of rdate.value.split(",")) {
        const time = parseTime(part.split("/")[0]!, rdate.params);
        if (time) walls.push(time.wall);
      }
    }
    for (const wall of walls) {
      const utc = wallMs(wall) - from;
      onsets.push({ utc, offset: to });
      if (!earliest || utc < earliest.utc) earliest = { utc, before: from };
    }
  }
  if (!onsets.length || !earliest) return null;
  onsets.sort((a, b) => a.utc - b.utc);
  const first = earliest;
  return offsetZone((utc) => {
    let low = 0;
    let high = onsets.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (onsets[mid]!.utc <= utc) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found < 0 ? first.before : onsets[found]!.offset;
  });
}

export type Rule = {
  freq: "SECONDLY" | "MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: IcsTime;
  byMonth?: number[];
  byWeekNo?: number[];
  byYearDay?: number[];
  byMonthDay?: number[];
  byDay?: { n: number; weekday: number }[];
  byHour?: number[];
  byMinute?: number[];
  bySecond?: number[];
  bySetPos?: number[];
  wkst: number;
};

const FREQS = new Set(["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

export function parseRule(value: string): Rule | null {
  const parts = Object.fromEntries(value.split(";").map((part) => {
    const equals = part.indexOf("=");
    return [part.slice(0, equals).trim().toUpperCase(), part.slice(equals + 1).trim()];
  }));
  const freq = parts.FREQ?.toUpperCase();
  if (!freq || !FREQS.has(freq)) return null;
  const numbers = (key: string, min: number, max: number) => {
    if (parts[key] === undefined) return undefined;
    const list = parts[key]!.split(",").map(Number).filter((n) => Number.isInteger(n) && n !== 0 ? Math.abs(n) >= min && Math.abs(n) <= max : min === 0 && n === 0);
    return list.length ? list : undefined;
  };
  const byDay = parts.BYDAY?.split(",").map((entry) => {
    const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(entry.trim());
    return match ? { n: match[1] ? +match[1] : 0, weekday: WEEKDAYS.indexOf(match[2]!.toUpperCase()) } : null;
  }).filter((entry): entry is { n: number; weekday: number } => !!entry);
  const interval = parts.INTERVAL ? Math.max(1, Math.floor(+parts.INTERVAL) || 1) : 1;
  const count = parts.COUNT ? Math.floor(+parts.COUNT) : undefined;
  const wkst = parts.WKST ? WEEKDAYS.indexOf(parts.WKST.toUpperCase()) : 0;
  return {
    freq: freq as Rule["freq"],
    interval,
    ...(count && count > 0 ? { count } : {}),
    ...(parts.UNTIL && parseTime(parts.UNTIL) ? { until: parseTime(parts.UNTIL)! } : {}),
    byMonth: numbers("BYMONTH", 1, 12),
    byWeekNo: numbers("BYWEEKNO", 1, 53),
    byYearDay: numbers("BYYEARDAY", 1, 366),
    byMonthDay: numbers("BYMONTHDAY", 1, 31),
    byDay: byDay?.length ? byDay : undefined,
    byHour: numbers("BYHOUR", 0, 23)?.filter((n) => n >= 0),
    byMinute: numbers("BYMINUTE", 0, 59)?.filter((n) => n >= 0),
    bySecond: numbers("BYSECOND", 0, 60)?.filter((n) => n >= 0),
    bySetPos: numbers("BYSETPOS", 1, 366),
    wkst: wkst < 0 ? 0 : wkst,
  };
}

function untilPassed(rule: Rule, wall: Wall, toUtc: (wall: Wall) => number): boolean {
  if (!rule.until) return false;
  if (rule.until.kind === "date") return dateKey(wall) !== dateKey(rule.until.wall) && compareWalls(wall, { ...rule.until.wall, hour: 23, minute: 59, second: 59 }) > 0;
  if (rule.until.kind === "utc") return wallMs(wall) - ZONE_SLACK_MS > wallMs(rule.until.wall) || (wallMs(wall) + ZONE_SLACK_MS > wallMs(rule.until.wall) && toUtc(wall) > wallMs(rule.until.wall));
  return compareWalls(wall, rule.until.wall) > 0;
}

function weekNumber(dn: number, year: number, wkst: number): { week: number; weeks: number } {
  const firstDay = dayNumber(year, 1, 1);
  const shift = (weekday(firstDay) - wkst + 7) % 7;
  const weekOneStart = shift >= 4 ? firstDay + 7 - shift : firstDay - shift;
  const nextFirst = dayNumber(year + 1, 1, 1);
  const nextShift = (weekday(nextFirst) - wkst + 7) % 7;
  const nextWeekOne = nextShift >= 4 ? nextFirst + 7 - nextShift : nextFirst - nextShift;
  return { week: Math.floor((dn - weekOneStart) / 7) + 1, weeks: (nextWeekOne - weekOneStart) / 7 };
}

function nthMatches(n: number, dn: number, first: number, last: number): boolean {
  if (n > 0) return dn - (n - 1) * 7 >= first && dn - (n - 1) * 7 < first + 7;
  return dn - (-n - 1) * 7 <= last && dn - (-n - 1) * 7 > last - 7;
}

function dayMatches(rule: Rule, freq: Rule["freq"], dn: number): boolean {
  const w = wallFromMs(dn * DAY_MS);
  if (rule.byMonth && !rule.byMonth.includes(w.month)) return false;
  const yearDays = leap(w.year) ? 366 : 365;
  const yday = dn - dayNumber(w.year, 1, 1) + 1;
  if (rule.byYearDay && !rule.byYearDay.some((d) => (d > 0 ? d === yday : yearDays + d + 1 === yday))) return false;
  const monthDays = daysInMonth(w.year, w.month);
  if (rule.byMonthDay && !rule.byMonthDay.some((d) => (d > 0 ? d === w.day : monthDays + d + 1 === w.day))) return false;
  if (rule.byWeekNo) {
    let { week, weeks } = weekNumber(dn, w.year, rule.wkst);
    if (week < 1) ({ week, weeks } = weekNumber(dn, w.year - 1, rule.wkst));
    else if (week > weeks) ({ week, weeks } = { week: week - weeks, weeks: weekNumber(dn, w.year + 1, rule.wkst).weeks });
    if (!rule.byWeekNo.some((n) => (n > 0 ? n === week : weeks + n + 1 === week))) return false;
  }
  if (rule.byDay) {
    const wd = weekday(dn);
    const inMonth = freq === "MONTHLY" || (freq === "YEARLY" && !!rule.byMonth);
    const ordinal = freq === "MONTHLY" || freq === "YEARLY";
    const first = inMonth ? dayNumber(w.year, w.month, 1) : dayNumber(w.year, 1, 1);
    const last = inMonth ? first + monthDays - 1 : first + yearDays - 1;
    if (!rule.byDay.some((d) => d.weekday === wd && (!d.n || !ordinal || nthMatches(d.n, dn, first, last)))) return false;
  }
  return true;
}

function withDefaults(rule: Rule, start: Wall): Rule {
  if (rule.byWeekNo || rule.byYearDay || rule.byMonthDay || rule.byDay) return rule;
  if (rule.freq === "YEARLY") return { ...rule, byMonth: rule.byMonth ?? [start.month], byMonthDay: [start.day] };
  if (rule.freq === "MONTHLY") return { ...rule, byMonthDay: [start.day] };
  if (rule.freq === "WEEKLY") return { ...rule, byDay: [{ n: 0, weekday: weekday(dayNumber(start.year, start.month, start.day)) }] };
  return rule;
}

function periodDays(rule: Rule, start: Wall, index: number): number[] {
  const step = index * rule.interval;
  const startDay = dayNumber(start.year, start.month, start.day);
  switch (rule.freq) {
    case "YEARLY": {
      const year = start.year + step;
      const months = rule.byMonth && !rule.byWeekNo && !rule.byYearDay ? [...rule.byMonth].sort((a, b) => a - b) : Array.from({ length: 12 }, (_, i) => i + 1);
      return months.flatMap((month) => Array.from({ length: daysInMonth(year, month) }, (_, d) => dayNumber(year, month, d + 1)));
    }
    case "MONTHLY": {
      const total = start.month - 1 + step;
      const year = start.year + Math.floor(total / 12);
      const month = (total % 12) + 1;
      return Array.from({ length: daysInMonth(year, month) }, (_, d) => dayNumber(year, month, d + 1));
    }
    case "WEEKLY": {
      const weekStart = startDay - ((weekday(startDay) - rule.wkst + 7) % 7) + step * 7;
      return Array.from({ length: 7 }, (_, d) => weekStart + d);
    }
    case "DAILY":
      return [startDay + step];
    default: {
      const unit = rule.freq === "HOURLY" ? 3_600_000 : rule.freq === "MINUTELY" ? 60_000 : 1000;
      return [Math.floor((wallMs(start) + step * unit) / DAY_MS)];
    }
  }
}

function periodTimes(rule: Rule, start: Wall, index: number, dn: number, allDay: boolean): Wall[] {
  const day = wallFromMs(dn * DAY_MS);
  if (allDay) return [day];
  const fine = rule.freq === "HOURLY" || rule.freq === "MINUTELY" || rule.freq === "SECONDLY";
  if (fine) {
    const unit = rule.freq === "HOURLY" ? 3_600_000 : rule.freq === "MINUTELY" ? 60_000 : 1000;
    const instant = wallFromMs(wallMs(start) + index * rule.interval * unit);
    if (rule.byHour && !rule.byHour.includes(instant.hour)) return [];
    const minutes = rule.freq === "HOURLY" ? rule.byMinute ?? [instant.minute] : rule.byMinute?.includes(instant.minute) === false ? [] : [instant.minute];
    const seconds = rule.freq === "SECONDLY" ? (rule.bySecond?.includes(instant.second) === false ? [] : [instant.second]) : rule.bySecond ?? [instant.second];
    return minutes.flatMap((minute) => seconds.map((second) => ({ ...day, hour: instant.hour, minute, second })));
  }
  const hours = rule.byHour ?? [start.hour];
  const minutes = rule.byMinute ?? [start.minute];
  const seconds = rule.bySecond ?? [start.second];
  return hours.flatMap((hour) => minutes.flatMap((minute) => seconds.map((second) => ({ ...day, hour, minute, second }))));
}

const FIXED_STEP: Partial<Record<Rule["freq"], number>> = { SECONDLY: 1000, MINUTELY: 60_000, HOURLY: 3_600_000, DAILY: DAY_MS, WEEKLY: 7 * DAY_MS };

function periodsBefore(rule: Rule, start: Wall, from: number): number {
  const delta = from - wallMs(start);
  if (!(delta > 0)) return 0;
  const step = FIXED_STEP[rule.freq];
  const target = wallFromMs(from);
  const periods = step ? Math.floor(delta / (step * rule.interval))
    : rule.freq === "MONTHLY" ? Math.floor(((target.year - start.year) * 12 + target.month - start.month) / rule.interval)
      : Math.floor((target.year - start.year) / rule.interval);
  return Math.max(0, periods - 1);
}

const simpleRule = (rule: Rule) => !!FIXED_STEP[rule.freq] && !rule.byMonth && !rule.byWeekNo && !rule.byYearDay && !rule.byMonthDay && !rule.byDay && !rule.byHour && !rule.byMinute && !rule.bySecond && !rule.bySetPos;

export type ExpandOptions = { from?: number; deadline?: number; onTruncate?: () => void };

export function expandRule(start: Wall, allDay: boolean, input: Rule, beyond: (wall: Wall) => boolean, passedUntil: (wall: Wall) => boolean, keep: (wall: Wall) => boolean = () => true, options: ExpandOptions = {}): Wall[] {
  const rule = withDefaults(input, start);
  const instances: Wall[] = keep(start) ? [start] : [];
  const seen = new Set([wallMs(start)]);
  const jump = options.from !== undefined && (!rule.count || simpleRule(input)) ? periodsBefore(rule, start, options.from) : 0;
  let produced = Math.max(1, jump);
  if (rule.count && produced >= rule.count) return instances;
  const truncate = () => {
    options.onTruncate?.();
    return instances;
  };
  for (let index = jump, walked = 0; ; index++, walked++) {
    if (walked >= MAX_PERIODS) return truncate();
    if ((walked & 255) === 0 && options.deadline !== undefined && performance.now() > options.deadline) return truncate();
    const days = periodDays(rule, start, index);
    if (!days.length) continue;
    if (beyond({ ...wallFromMs(days[0]! * DAY_MS), hour: 0, minute: 0, second: 0 }) && index > 0) break;
    let candidates = days.filter((dn) => dayMatches(rule, rule.freq, dn)).flatMap((dn) => periodTimes(rule, start, index, dn, allDay)).sort(compareWalls);
    if (rule.bySetPos) {
      const all = candidates;
      candidates = rule.bySetPos.map((p) => (p > 0 ? all[p - 1] : all[all.length + p])).filter((w): w is Wall => !!w).sort(compareWalls);
    }
    for (const candidate of candidates) {
      if (compareWalls(candidate, start) <= 0) continue;
      if (passedUntil(candidate) || beyond(candidate)) return instances;
      const key = wallMs(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      produced++;
      if (keep(candidate)) instances.push(candidate);
      if (rule.count && produced >= rule.count) return instances;
      if (instances.length >= MAX_INSTANCES) return truncate();
    }
  }
  return instances;
}

export type ZoneLookup = (tzid: string) => Zone | null;

export function zoneFor(time: IcsTime, lookup: ZoneLookup): Zone {
  if (time.kind === "utc") return UTC_ZONE;
  if (time.kind === "zoned" && time.tzid) return lookup(time.tzid) ?? LOCAL_ZONE;
  return LOCAL_ZONE;
}

function walk(components: IcsComponent[], visit: (component: IcsComponent) => boolean) {
  const pending = [...components].reverse();
  while (pending.length) {
    const component = pending.pop()!;
    if (!visit(component)) continue;
    for (let i = component.components.length - 1; i >= 0; i--) pending.push(component.components[i]!);
  }
}

export function referencedTzids(components: IcsComponent[]): Set<string> {
  const tzids = new Set<string>();
  walk(components, (component) => {
    if (component.name === "VTIMEZONE") return false;
    for (const p of component.properties) if (p.params.TZID) tzids.add(p.params.TZID);
    return true;
  });
  return tzids;
}

export function inlineZones(components: IcsComponent[]): Map<string, IcsComponent> {
  const zones = new Map<string, IcsComponent>();
  walk(components, (component) => {
    if (component.name !== "VTIMEZONE") return true;
    const tzid = property(component, "TZID")?.value;
    if (tzid) zones.set(tzid, component);
    return false;
  });
  return zones;
}

export function events(components: IcsComponent[]): IcsComponent[] {
  const found: IcsComponent[] = [];
  walk(components, (component) => {
    if (component.name !== "VEVENT") return true;
    found.push(component);
    return false;
  });
  return found;
}

export type Occurrence = { event: IcsComponent; start: number; end: number; allDay: boolean };

type Timing = { start: IcsTime; zone: Zone; allDay: boolean; days: number; ms: number };

function timing(event: IcsComponent, lookup: ZoneLookup): Timing | null {
  const dtstart = property(event, "DTSTART");
  const start = dtstart && parseTime(dtstart.value, dtstart.params);
  if (!start) return null;
  const allDay = start.kind === "date";
  const zone = allDay ? LOCAL_ZONE : zoneFor(start, lookup);
  const dtend = property(event, "DTEND");
  const end = dtend && parseTime(dtend.value, dtend.params);
  const duration = property(event, "DURATION");
  const parsedDuration = duration && parseDuration(duration.value);
  if (allDay) {
    const days = end && end.kind === "date" ? Math.max(1, dayNumber(end.wall.year, end.wall.month, end.wall.day) - dayNumber(start.wall.year, start.wall.month, start.wall.day))
      : parsedDuration ? Math.max(1, parsedDuration.days + Math.ceil(parsedDuration.ms / DAY_MS)) : 1;
    return { start, zone, allDay, days, ms: 0 };
  }
  if (end && end.kind !== "date") {
    return { start, zone, allDay, days: 0, ms: Math.max(0, zoneFor(end, lookup).toUtc(end.wall) - zone.toUtc(start.wall)) };
  }
  if (parsedDuration) return { start, zone, allDay, days: parsedDuration.days, ms: parsedDuration.ms };
  return { start, zone, allDay, days: 0, ms: 0 };
}

function instance(t: Timing, wall: Wall): { start: number; end: number } {
  const start = t.zone.toUtc(wall);
  if (t.allDay) return { start, end: LOCAL_ZONE.toUtc(addDays(wall, t.days)) };
  const end = t.days ? t.zone.toUtc(addDays(wall, t.days)) + t.ms : start + t.ms;
  return { start, end: Math.max(start, end) };
}

function recurrenceKey(time: IcsTime, t: Timing, lookup: ZoneLookup): string {
  if (time.kind === "date" || t.allDay) return `d:${dateKey(time.wall)}`;
  return `t:${zoneFor(time, lookup).toUtc(time.wall)}`;
}

function wallKey(wall: Wall, t: Timing): string {
  return t.allDay ? `d:${dateKey(wall)}` : `t:${t.zone.toUtc(wall)}`;
}

function dateList(event: IcsComponent, name: string): IcsTime[] {
  return properties(event, name).flatMap((p) => p.value.split(",").map((part) => parseTime(part.split("/")[0]!, p.params)).filter((time): time is IcsTime => !!time));
}

function atOrAfter(zone: Zone, wall: Wall, shift: number, limit: number): boolean {
  const approximate = wallMs(wall) + shift;
  if (approximate - ZONE_SLACK_MS >= limit) return true;
  if (approximate + ZONE_SLACK_MS < limit) return false;
  return zone.toUtc(wall) + shift >= limit;
}

export type ExpansionBudget = { deadline: number; truncated: string[] };

export function occurrences(objects: IcsComponent[], rangeStart: number, rangeEnd: number, lookup: ZoneLookup, budget: ExpansionBudget = { deadline: Infinity, truncated: [] }): Occurrence[] {
  const byUid = new Map<string, { master?: IcsComponent; overrides: IcsComponent[] }>();
  for (const event of objects) {
    const uid = property(event, "UID")?.value ?? "";
    const entry = byUid.get(uid) ?? { overrides: [] };
    if (property(event, "RECURRENCE-ID")) entry.overrides.push(event);
    else entry.master = event;
    byUid.set(uid, entry);
  }
  const found: Occurrence[] = [];
  const overlaps = (start: number, end: number) => (end > start ? end > rangeStart : end >= rangeStart) && start < rangeEnd;
  for (const [uid, { master, overrides }] of byUid) {
    const masterTiming = master && timing(master, lookup);
    const replaced = new Set<string>();
    for (const override of overrides) {
      const recurrence = property(override, "RECURRENCE-ID")!;
      const id = parseTime(recurrence.value, recurrence.params);
      const own = timing(override, lookup);
      if (id && masterTiming) replaced.add(recurrenceKey(id, masterTiming, lookup));
      if (!own) continue;
      const placed = instance(own, own.start.wall);
      if (overlaps(placed.start, placed.end)) found.push({ event: override, ...placed, allDay: own.allDay });
    }
    if (!master || !masterTiming) continue;
    const rule = property(master, "RRULE");
    const parsedRule = rule ? parseRule(rule.value) : null;
    if (parsedRule && performance.now() > budget.deadline) {
      budget.truncated.push(uid);
      continue;
    }
    const reach = masterTiming.ms + (masterTiming.days + 2) * DAY_MS;
    const walls = parsedRule
      ? expandRule(masterTiming.start.wall, masterTiming.allDay, parsedRule, (w) => atOrAfter(masterTiming.zone, w, 0, rangeEnd), (w) => untilPassed(parsedRule, w, masterTiming.zone.toUtc),
        (w) => atOrAfter(masterTiming.zone, w, reach, rangeStart), { from: rangeStart - reach - ZONE_SLACK_MS, deadline: budget.deadline, onTruncate: () => budget.truncated.push(uid) })
      : [masterTiming.start.wall];
    const excluded = new Set(dateList(master, "EXDATE").flatMap((time) => time.kind === "date" ? [`d:${dateKey(time.wall)}`, `date:${dateKey(time.wall)}`] : [recurrenceKey(time, masterTiming, lookup)]));
    const emitted = new Set<string>();
    const emit = (key: string, wall: Wall, placed: { start: number; end: number }) => {
      if (emitted.has(key) || excluded.has(key) || excluded.has(`date:${dateKey(wall)}`) || replaced.has(key)) return;
      emitted.add(key);
      if (overlaps(placed.start, placed.end)) found.push({ event: master, ...placed, allDay: masterTiming.allDay });
    };
    for (const wall of walls) emit(wallKey(wall, masterTiming), wall, instance(masterTiming, wall));
    for (const rdate of dateList(master, "RDATE")) {
      if (masterTiming.allDay || rdate.kind === "date") {
        emit(`d:${dateKey(rdate.wall)}`, rdate.wall, instance({ ...masterTiming, zone: LOCAL_ZONE }, { ...rdate.wall, hour: 0, minute: 0, second: 0 }));
        continue;
      }
      const start = zoneFor(rdate, lookup).toUtc(rdate.wall);
      emit(`t:${start}`, rdate.wall, { start, end: start + masterTiming.ms + masterTiming.days * DAY_MS });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
