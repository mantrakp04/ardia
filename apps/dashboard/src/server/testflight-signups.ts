export const SIGNUP_OBJECT = /^[0-9a-f]{32}\.json$/;
export const MAX_SIGNUP_BYTES = 1024;
export const MAX_EMAIL_LENGTH = 254;

export const JUNK_REASONS = ["empty", "too-large", "not-json", "not-object", "no-email", "bad-email", "honeypot"] as const;
export type JunkReason = (typeof JUNK_REASONS)[number];
export type JunkCounts = Record<JunkReason, number>;

export type ListedObject = { name: string; size: number; mtime: number };
export type ReadObject = ListedObject & { body?: string | null };

export type Signup = { email: string; key: string; at: number; objects: string[] };
export type SignupList = { signups: Signup[]; junk: JunkCounts; unreadable: number; scanned: number };

const FORBIDDEN_IN_EMAIL = /[\s\p{Cc}\p{Cf}]/u;

export function normalizedEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim();
  if (!email || email.length > MAX_EMAIL_LENGTH || FORBIDDEN_IN_EMAIL.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts as [string, string];
  if (local.length < 1 || local.length > 64) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  return email;
}

export const emailKey = (email: string) => email.trim().toLowerCase();

export function objectName(fullPath: unknown): string | null {
  if (typeof fullPath !== "string") return null;
  const name = fullPath.split("/").pop() ?? "";
  return SIGNUP_OBJECT.test(name) ? name : null;
}

export function listedObjects(entries: unknown): ListedObject[] {
  if (!Array.isArray(entries)) return [];
  const out: ListedObject[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = objectName(e.FullPath);
    if (!name) continue;
    const size = typeof e.FileSize === "number" && Number.isFinite(e.FileSize) ? e.FileSize : Number(e.FileSize);
    const mtime = typeof e.Mtime === "string" ? Date.parse(e.Mtime) : NaN;
    out.push({ name, size: Number.isFinite(size) && size >= 0 ? size : 0, mtime: Number.isFinite(mtime) ? mtime : 0 });
  }
  return out;
}

export function sizeJunk(object: ListedObject): JunkReason | null {
  if (object.size <= 0) return "empty";
  if (object.size > MAX_SIGNUP_BYTES) return "too-large";
  return null;
}

export function classifyBody(body: string): { email: string } | { junk: JunkReason } {
  if (!body.trim()) return { junk: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { junk: "not-json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { junk: "not-object" };
  const fields = parsed as Record<string, unknown>;
  if (Object.hasOwn(fields, "website") && fields.website !== "") return { junk: "honeypot" };
  if (typeof fields.email !== "string") return { junk: "no-email" };
  const email = normalizedEmail(fields.email);
  return email ? { email } : { junk: "bad-email" };
}

export const emptyJunk = (): JunkCounts => Object.fromEntries(JUNK_REASONS.map((reason) => [reason, 0])) as JunkCounts;

export function buildSignupList(objects: ReadObject[]): SignupList {
  const junk = emptyJunk();
  let unreadable = 0;
  let scanned = 0;
  const byKey = new Map<string, Signup>();
  const ordered = objects.filter((o) => SIGNUP_OBJECT.test(o.name)).sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  for (const object of ordered) {
    scanned++;
    const tooBig = sizeJunk(object);
    if (tooBig) {
      junk[tooBig]++;
      continue;
    }
    if (object.body === null || object.body === undefined) {
      unreadable++;
      continue;
    }
    const result = new TextEncoder().encode(object.body).length > MAX_SIGNUP_BYTES ? { junk: "too-large" as const } : classifyBody(object.body);
    if ("junk" in result) {
      junk[result.junk]++;
      continue;
    }
    const key = emailKey(result.email);
    const known = byKey.get(key);
    if (known) known.objects.push(object.name);
    else byKey.set(key, { email: result.email, key, at: object.mtime, objects: [object.name] });
  }
  const signups = [...byKey.values()].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  return { signups, junk, unreadable, scanned };
}
