export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const FORBIDDEN_IN_EMAIL = /[\s\p{Cc}\p{Cf}]/u;

export function normalizedEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim();
  if (!email || email.length > MAX_EMAIL_LENGTH || FORBIDDEN_IN_EMAIL.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts as [string, string];
  if (local.length < 1 || local.length > MAX_LOCAL_LENGTH) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  return email;
}

export const emailKey = (email: string) => email.trim().toLowerCase();
