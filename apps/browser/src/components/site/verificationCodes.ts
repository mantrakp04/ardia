export type VerificationCodeSetup = { issuer: string; account: string };

export type VerificationCodeOffer = VerificationCodeSetup & { url: string; origin: string };

export const MAX_VERIFICATION_CODE_URL = 2048;

const decoded = (text: string, plusIsSpace: boolean): string | null => {
  try {
    return decodeURIComponent(plusIsSpace ? text.replace(/\+/g, " ") : text);
  } catch {
    return null;
  }
};

const tidy = (text: string) => text.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();

function queryParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    const key = decoded(at < 0 ? pair : pair.slice(0, at), true)?.toLowerCase();
    const value = decoded(at < 0 ? "" : pair.slice(at + 1), true);
    if (key && value !== null && !params.has(key)) params.set(key, value);
  }
  return params;
}

export function parseVerificationCodeSetup(url: string): VerificationCodeSetup | null {
  if (typeof url !== "string" || url.length > MAX_VERIFICATION_CODE_URL || /[\s<>"{}|\\^`]/.test(url)) return null;
  const migration = /^otpauth-migration:\/\/offline\/?\?([^#]*)/i.exec(url);
  if (migration) return queryParams(migration[1]!).get("data")?.trim() ? { issuer: "", account: "" } : null;
  const otp = /^otpauth:\/\/(?:totp|hotp)\/([^?#]*)(?:\?([^#]*))?/i.exec(url);
  if (!otp) return null;
  const params = queryParams(otp[2] ?? "");
  if (!params.get("secret")?.trim()) return null;
  const label = decoded(otp[1]!, false);
  if (label === null) return null;
  const colon = label.indexOf(":");
  const prefix = colon < 0 ? "" : tidy(label.slice(0, colon));
  return { issuer: tidy(params.get("issuer") ?? "") || prefix, account: tidy(colon < 0 ? label : label.slice(colon + 1)) };
}

const clipped = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function verificationCodeSetupCopy(setup: VerificationCodeSetup, host = ""): { title: string; message: string } {
  const issuer = clipped(setup.issuer, 40);
  const account = clipped(setup.account, 64);
  const site = host ? `From ${clipped(host, 64)}. ` : "";
  return {
    title: issuer ? `Set up a verification code for ${issuer}?` : "Set up this verification code?",
    message: `${site}${account ? `Passwords can fill the codes for ${account} from now on.` : "Passwords can fill the codes from now on."}`,
  };
}

export const isVerificationCodeScheme = (scheme: string) => /^otpauth(-migration)?$/i.test(scheme.replace(/:$/, ""));

export function originOf(url: string): string {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

export const offerSurvivesNavigation = (offer: VerificationCodeOffer | null, url: string): VerificationCodeOffer | null =>
  offer && offer.origin && offer.origin === originOf(url) ? offer : null;
