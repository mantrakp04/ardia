export const REPORT_KINDS = [
  { value: "bug", title: "Bug" },
  { value: "slow", title: "Slow" },
  { value: "idea", title: "Idea" },
  { value: "other", title: "Other" },
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number]["value"];

export const TITLE_MAX = 67;
export const DESCRIPTION_MAX = 4000;
export const CONTACT_MAX = 200;
export const PAGE_ADDRESS_MAX = 2048;
export const DIAGNOSTICS_MAX_BYTES = 64 * 1024;
export const WATCH_DAYS = 14;
export const LOCAL_EVENTS_DAYS = 7;
export const RECORDING_MAX_SECONDS = 60;
export const TRACE_MAX_SECONDS = 30;

export type AttachmentKey = "system" | "errors" | "settings" | "page";

export type ReportDraft = {
  kind: ReportKind;
  title: string;
  description: string;
  contact: string;
  includePages: boolean;
  trace: boolean;
  attach: Record<AttachmentKey, boolean>;
  watch: boolean;
};

export const DEFAULT_ATTACH: Readonly<Record<AttachmentKey, boolean>> = { system: true, errors: true, settings: true, page: false };

export const emptyDraft = (): ReportDraft => ({
  kind: "bug",
  title: "",
  description: "",
  contact: "",
  includePages: false,
  trace: false,
  attach: { ...DEFAULT_ATTACH },
  watch: false,
});

type Segmenter = { segment(text: string): Iterable<{ segment: string }> };

const intlSegmenter = (() => {
  const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => Segmenter }).Segmenter;
  try {
    return Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
})();

const ZWJ = 0x200d;

function extendsCluster(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x0483 && cp <= 0x0489) ||
    (cp >= 0x0591 && cp <= 0x05bd) ||
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    (cp >= 0x0900 && cp <= 0x0903) ||
    (cp >= 0x093a && cp <= 0x094f) ||
    (cp >= 0x0e31 && cp <= 0x0e3a && cp !== 0x0e32 && cp !== 0x0e33) ||
    (cp >= 0x0e47 && cp <= 0x0e4e) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0x3099 && cp <= 0x309a) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef) ||
    cp === ZWJ
  );
}

const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;

export function fallbackGraphemes(text: string): string[] {
  const out: string[] = [];
  let joinNext = false;
  let regionalOpen = false;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const last = out.length - 1;
    if (last >= 0 && (joinNext || extendsCluster(cp) || (regionalOpen && isRegionalIndicator(cp)))) {
      out[last] += char;
      if (isRegionalIndicator(cp)) regionalOpen = false;
    } else {
      out.push(char);
      regionalOpen = isRegionalIndicator(cp);
    }
    joinNext = cp === ZWJ;
  }
  return out;
}

export function graphemes(text: string): string[] {
  if (intlSegmenter) return Array.from(intlSegmenter.segment(text), (s) => s.segment);
  return fallbackGraphemes(text);
}

export const characterCount = (text: string) => graphemes(text).length;

export const codePointCount = (text: string) => Array.from(text).length;

export const fitsLimit = (text: string, max: number) => text.length <= max || (codePointCount(text) <= max && characterCount(text) <= max);

export function clampCharacters(text: string, max: number): string {
  if (fitsLimit(text, max)) return text;
  let kept = "";
  let points = 0;
  let count = 0;
  for (const part of graphemes(text)) {
    const size = codePointCount(part);
    if (count + 1 > max || points + size > max) break;
    kept += part;
    points += size;
    count += 1;
  }
  return kept;
}

export const clampTitle = (text: string) => clampCharacters(text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " "), TITLE_MAX);
export const clampDescription = (text: string) => clampCharacters(text, DESCRIPTION_MAX);
export const clampContact = (text: string) => clampCharacters(text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " "), CONTACT_MAX);

export type TitleCounter = { count: number; max: number; full: boolean; near: boolean };

export function titleCounter(title: string): TitleCounter {
  const count = characterCount(title);
  return { count, max: TITLE_MAX, full: count >= TITLE_MAX, near: count >= TITLE_MAX - 10 };
}

export type DraftProblem = "title" | "description" | "titleTooLong" | "descriptionTooLong" | "contactTooLong";

export function draftProblems(draft: ReportDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const title = draft.title.trim();
  const description = draft.description.trim();
  if (!title) problems.push("title");
  else if (!fitsLimit(title, TITLE_MAX)) problems.push("titleTooLong");
  if (!description) problems.push("description");
  else if (!fitsLimit(description, DESCRIPTION_MAX)) problems.push("descriptionTooLong");
  if (!fitsLimit(draft.contact.trim(), CONTACT_MAX)) problems.push("contactTooLong");
  return problems;
}

export const canSend = (draft: ReportDraft) => draftProblems(draft).length === 0;

export type DraftField = "title" | "description" | "contact";

const PROBLEM_FIELD: Record<DraftProblem, DraftField> = {
  title: "title",
  titleTooLong: "title",
  description: "description",
  descriptionTooLong: "description",
  contactTooLong: "contact",
};

const PROBLEM_HINT: Record<DraftProblem, string> = {
  title: "Add a title to send",
  titleTooLong: `Shorten the title to ${TITLE_MAX} characters`,
  description: "Say what happened to send",
  descriptionTooLong: `Shorten this to ${DESCRIPTION_MAX.toLocaleString("en-US")} characters`,
  contactTooLong: `Shorten this to ${CONTACT_MAX} characters`,
};

export function fieldProblem(problems: DraftProblem[], field: DraftField): { problem: DraftProblem; hint: string } | null {
  const problem = problems.find((p) => PROBLEM_FIELD[p] === field);
  return problem ? { problem, hint: PROBLEM_HINT[problem] } : null;
}

export type ReportFile = { name: string; path: string; bytes: number; type: string };

export type PayloadContext = {
  installId: string;
  sessionId: string | null;
  appVersion: string;
  appBuild: string;
  channel: string | null;
  osVersion: string;
  arch: string;
  pageAddress: string | null;
  sharing: boolean;
  diagnostics: Record<string, unknown>;
  files: ReportFile[];
};

export function watchDays(draft: ReportDraft, sharing: boolean): number {
  return sharing || draft.watch ? WATCH_DAYS : 0;
}

const utf8Bytes = (text: string) => Array.from(text).reduce((sum, ch) => sum + (ch.codePointAt(0)! < 0x80 ? 1 : ch.codePointAt(0)! < 0x800 ? 2 : ch.codePointAt(0)! < 0x10000 ? 3 : 4), 0);

export function capDiagnostics(diagnostics: Record<string, unknown>): Record<string, unknown> {
  const capped: Record<string, unknown> = {};
  let bytes = 2;
  for (const [key, value] of Object.entries(diagnostics)) {
    const entry = utf8Bytes(JSON.stringify({ [key]: value }));
    if (bytes + entry > DIAGNOSTICS_MAX_BYTES) continue;
    capped[key] = value;
    bytes += entry;
  }
  return capped;
}

export function buildPayload(draft: ReportDraft, ctx: PayloadContext): Record<string, unknown> {
  const contact = clampContact(draft.contact.trim());
  const page = draft.attach.page && ctx.pageAddress ? ctx.pageAddress.slice(0, PAGE_ADDRESS_MAX) : null;
  return {
    kind: draft.kind,
    title: clampTitle(draft.title.trim()).trim(),
    description: clampDescription(draft.description.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim()),
    source: "app",
    install_id: ctx.installId,
    session_id: ctx.sessionId,
    app_version: ctx.appVersion,
    app_build: ctx.appBuild,
    channel: ctx.channel,
    os_version: ctx.osVersion,
    arch: ctx.arch,
    ...(contact ? { contact } : {}),
    ...(page ? { page_address: page } : {}),
    watch_days: watchDays(draft, ctx.sharing),
    diagnostics: capDiagnostics(ctx.diagnostics),
    attachments: ctx.files.map(({ name, bytes, type }) => ({ name, bytes, type })),
  };
}

export function watchEndDate(from: number, days = WATCH_DAYS): number {
  return from + days * 86_400_000;
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
