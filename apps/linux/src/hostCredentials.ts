import type { ArdiaHost } from "./host";
import { callHost, hostProfile, invokeHost } from "./host.ts";
import { releaseHeldLogin, releaseHeldLoginIfGone } from "./hostSync.ts";

export const CREDENTIAL_CAPABILITIES = [
  "ArdiaPasswords.status",
  "ArdiaPasswords.unlock",
  "ArdiaPasswords.reveal",
  "ArdiaPasswords.save",
  "ArdiaPasswords.update",
  "ArdiaPasswords.export",
  "ArdiaAutofill.status",
  "ArdiaAutofill.saveCard",
  "ArdiaAutofill.cardNumber",
] as const;

export type CredentialAvailability = { available: boolean; reason?: string; code?: string; message?: string };
type ReauthStatus = {
  reauth: boolean;
  reauthReason?: string;
  reauthMessage?: string;
  backend: string;
  protection?: "keyring" | "portal" | "obfuscated" | "none" | "unknown";
  protectionFallback?: boolean;
  storage?: string;
};
export type PasswordStatus = ReauthStatus & { passwords: CredentialAvailability };
export type AutofillStatus = ReauthStatus & { addresses: CredentialAvailability; cards: CredentialAvailability };

const SECRET_CALLS = new Set(["passwords.save", "passwords.update", "passwords.add", "autofill.saveCard"]);

type Json = Record<string, unknown>;

const credentialError = (code: string, message: string) => Object.assign(new Error(message), { code });
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

function argsOf(args: unknown): Json {
  if (args === null || args === undefined) return {};
  if (typeof args !== "string") throw credentialError("ERR_CREDENTIAL_REQUEST", "Arguments require JSON text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    throw credentialError("ERR_CREDENTIAL_REQUEST", "Arguments are not JSON");
  }
  if (!isObject(parsed)) throw credentialError("ERR_CREDENTIAL_REQUEST", "Arguments must be an object");
  return parsed;
}

function typed<T>(host: ArdiaHost, method: string, args: unknown[]): Promise<T> {
  return invokeHost<T>(method, { args }, host);
}

const dated = (list: unknown): (Json & { created: number; modified: number })[] =>
  Array.isArray(list) ? list.filter(isObject).map((entry) => ({ ...entry, created: 0, modified: 0 })) : [];

function shape(name: string, reply: string): string {
  if (name !== "passwords.list" && name !== "autofill.addresses" && name !== "autofill.cards") return reply;
  const parsed = JSON.parse(reply) as unknown;
  if (!isObject(parsed)) throw credentialError("ERR_BAD_REPLY", "The engine reply is not an object");
  if (name === "passwords.list") {
    const passwords = dated(parsed.passwords).map(({ origin, username, created, modified }) => ({
      origin: typeof origin === "string" ? origin : "",
      username: typeof username === "string" ? username : "",
      created,
      modified,
    }));
    return JSON.stringify({ passwords });
  }
  const key = name === "autofill.addresses" ? "addresses" : "cards";
  return JSON.stringify({ [key]: dated(parsed[key]) });
}

async function domainCall(host: ArdiaHost, domain: "passwords" | "autofill", verb: string, profile: string, args: unknown): Promise<string> {
  const name = `${domain}.${verb}`;
  const input = argsOf(args);
  const owner = hostProfile(profile, host);
  if (name === "passwords.unlock") {
    const reply = await typed<{ unlocked?: unknown }>(host, "ArdiaPasswords.unlock", [owner]);
    return JSON.stringify({ unlocked: reply?.unlocked === true });
  }
  if (name === "passwords.reveal") {
    const reply = await typed<{ password?: unknown }>(host, "ArdiaPasswords.reveal", [owner, input.origin, input.username]);
    return JSON.stringify({ password: typeof reply?.password === "string" ? reply.password : null });
  }
  if (name === "passwords.export") {
    const reply = await typed<{ status?: unknown; path?: unknown }>(host, "ArdiaPasswords.export", [owner]).catch((error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "ERR_REAUTH_UNAVAILABLE" || code === "ERR_REAUTH_DENIED") return { status: "reauthFailed" } as { status?: unknown; path?: unknown };
      throw error;
    });
    const status = typeof reply?.status === "string" ? reply.status : "writeFailed";
    return JSON.stringify(typeof reply?.path === "string" && status === "succeeded" ? { status, path: reply.path } : { status });
  }
  if (name === "autofill.cardNumber") {
    const reply = await typed<{ number?: unknown }>(host, "ArdiaAutofill.cardNumber", [owner, input.id]);
    return JSON.stringify({ number: typeof reply?.number === "string" ? reply.number : null });
  }
  if (SECRET_CALLS.has(name)) throw credentialError("ERR_SECRET_ROUTE", "Secret operations use their dedicated native method");
  if (name === "passwords.remove") {
    let reply: string;
    try {
      reply = shape(name, await callHost(name, profile, typeof args === "string" ? args : "{}", host));
    } catch (error) {
      if (await releaseHeldLoginIfGone(host, profile, input.origin, input.username)) return JSON.stringify({ ok: true });
      throw error;
    }
    await releaseHeldLogin(profile, input.origin, input.username);
    return reply;
  }
  return shape(name, await callHost(name, profile, typeof args === "string" ? args : "{}", host));
}

export function credentialModuleMethod(host: ArdiaHost, name: string, method: string): unknown {
  if (name === "ArdiaPasswords") {
    if (method === "call") return (verb: string, profile: string, args: string) => domainCall(host, "passwords", verb, profile, args);
    if (method === "save") {
      return (profile: string, origin: string, username: string, password: string) =>
        typed(host, "ArdiaPasswords.save", [hostProfile(profile, host), origin, username, password]).then(() => JSON.stringify({ ok: true }));
    }
    if (method === "update") {
      return (profile: string, origin: string, username: string, newUsername: string | null, newPassword: string | null) =>
        typed(host, "ArdiaPasswords.update", [hostProfile(profile, host), origin, username, newUsername ?? null, newPassword ?? null]).then(() =>
          JSON.stringify({ ok: true }),
        );
    }
  }
  if (name === "ArdiaAutofill") {
    if (method === "call") return (verb: string, profile: string, args: string) => domainCall(host, "autofill", verb, profile, args);
    if (method === "saveCard") {
      return (profile: string, card: unknown, number: string | null) =>
        typed<{ id?: unknown }>(host, "ArdiaAutofill.saveCard", [hostProfile(profile, host), isObject(card) ? card : {}, number ?? null]).then((reply) => {
          if (typeof reply?.id !== "string") throw credentialError("ERR_BAD_REPLY", "The card was saved without an id");
          return JSON.stringify({ id: reply.id });
        });
    }
  }
  return undefined;
}

export function passwordStatus(host: ArdiaHost, profile = ""): Promise<PasswordStatus> {
  return typed<PasswordStatus>(host, "ArdiaPasswords.status", [hostProfile(profile, host)]);
}

export function autofillStatus(host: ArdiaHost, profile = ""): Promise<AutofillStatus> {
  return typed<AutofillStatus>(host, "ArdiaAutofill.status", [hostProfile(profile, host)]);
}

type CredentialKind = "passwords" | "autofill";

function unavailableEntries(status: PasswordStatus | AutofillStatus, kind: CredentialKind): CredentialAvailability[] {
  const entries = kind === "passwords" ? [(status as PasswordStatus).passwords] : [(status as AutofillStatus).addresses, (status as AutofillStatus).cards];
  return entries.filter((entry): entry is CredentialAvailability => !!entry && !entry.available);
}

export function credentialNotice(status: PasswordStatus | AutofillStatus | null | undefined, kind: CredentialKind): string | null {
  if (!status) return null;
  const parts: string[] = [];
  for (const entry of unavailableEntries(status, kind)) if (entry.message && !parts.includes(entry.message)) parts.push(entry.message);
  if (!status.reauth) {
    parts.push(
      status.reauthMessage
        ? `${status.reauthMessage}.`
        : kind === "passwords"
          ? "System authentication is unavailable, so saved passwords can't be shown, changed or exported."
          : "System authentication is unavailable, so card numbers can't be shown.",
    );
  }
  if (status.protectionFallback) {
    const secrets = kind === "passwords" ? "new passwords" : "new card numbers";
    parts.push(
      `Your keyring didn't answer, so Chromium only obfuscates ${secrets} with its built-in key instead of encrypting them. Unlock or start your keyring (Secret Service or KWallet) and restart Ardia.`,
    );
  }
  if (status.backend === "basic") parts.push("Chromium is using its basic password store, which only obfuscates secrets instead of encrypting them with your keyring.");
  return parts.length ? parts.join(" ") : null;
}

export function credentialNoticeTitle(status: PasswordStatus | AutofillStatus, kind: CredentialKind): string {
  if (unavailableEntries(status, kind).length) return kind === "passwords" ? "Passwords are unavailable" : "Some autofill data is unavailable";
  if (status.protectionFallback || status.backend === "basic") return kind === "passwords" ? "Passwords aren't encrypted with your keyring" : "Card numbers aren't encrypted with your keyring";
  if (!status.reauth) return "System authentication is unavailable";
  return kind === "passwords" ? "Passwords are unavailable" : "Some autofill data is unavailable";
}

export function credentialStorage(status: PasswordStatus | AutofillStatus | null | undefined, kind: CredentialKind): string | null {
  if (!status?.protection || !status.storage) return null;
  const auth = kind === "passwords" ? "Showing, changing or exporting them asks for your system password (polkit)." : "Showing one asks for your system password (polkit).";
  const lead = kind === "passwords" ? "Saved separately for each profile and" : "Card numbers are";
  switch (status.protection) {
    case "keyring":
    case "portal":
      return `${lead} encrypted with a key from ${status.storage}. ${auth}`;
    case "obfuscated":
      return `${lead} protected only by ${status.storage}. ${auth}`;
    case "none":
      return `${kind === "passwords" ? "Saved passwords" : "Card numbers"} can't be protected: no encryption key is available.`;
    default:
      return `Ardia couldn't check which key protects ${kind === "passwords" ? "saved passwords" : "card numbers"}, so whether they're encrypted is unknown.`;
  }
}
