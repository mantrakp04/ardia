import { isFields, ok, originalProfile, served, type Engine, type Fields, type Handlers } from "./calling";

const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443", ws: "80", wss: "443", ftp: "21" };
const AUTHORITY = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\\]*)/i;
const HOST_AND_PORT = /^([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::([0-9]*))?$/;

export function loginOrigin(url: string): string {
  const parts = AUTHORITY.exec(url);
  if (!parts) return url;
  const scheme = parts[1]!.toLowerCase();
  if (!Object.hasOwn(DEFAULT_PORTS, scheme)) return url;
  const authority = parts[2]!.toLowerCase();
  const host = HOST_AND_PORT.exec(authority.slice(authority.lastIndexOf("@") + 1));
  if (!host) return url;
  const port = host[2] ? String(Number(host[2])) : "";
  return `${scheme}://${host[1]}${port && port !== DEFAULT_PORTS[scheme] ? `:${port}` : ""}`;
}

const login = (origin: string, username: string): Fields => ({ origin: loginOrigin(origin), username });

export const passwordCalls: Handlers = {
  list: async (args, engine) => {
    const result = await served(engine, "ac_passwords_list", originalProfile(args.profile));
    if (!Array.isArray(result.passwords)) return ok(result);
    const passwords = result.passwords.map((entry: unknown) => {
      const saved = isFields(entry) ? entry : {};
      return { origin: saved.origin ?? "", username: saved.username ?? "", created: 0, modified: 0 };
    });
    return ok({ passwords });
  },
  unlock: async (args, engine) => ok(await served(engine, "ac_passwords_unlock", originalProfile(args.profile))),
  reveal: async (args, engine) => {
    const entry = login(args.text("origin"), args.text("username"));
    return ok(await served(engine, "ac_passwords_reveal", originalProfile(args.profile), entry));
  },
  remove: async (args, engine) => {
    const entry = login(args.text("origin"), args.text("username"));
    return ok(await served(engine, "ac_passwords_remove", originalProfile(args.profile), entry));
  },
  neverSaveOrigins: async (args, engine) => ok(await served(engine, "ac_passwords_exceptions", originalProfile(args.profile))),
  allowSaving: async (args, engine) => {
    const origin = loginOrigin(args.text("origin"));
    return ok(await served(engine, "ac_passwords_allow", originalProfile(args.profile), { origin }));
  },
};

export async function savePassword(engine: Engine, profile: string, origin: string, username: string, password: string): Promise<string> {
  const entry = { ...login(origin ?? "", username ?? ""), password: password ?? "" };
  return ok(await served(engine, "ac_passwords_add", originalProfile(profile), entry));
}

export async function updatePassword(
  engine: Engine,
  profile: string,
  origin: string,
  username: string,
  newUsername: string | null,
  newPassword: string | null,
): Promise<string> {
  const entry = login(origin ?? "", username ?? "");
  if (typeof newUsername === "string") entry.newUsername = newUsername;
  if (typeof newPassword === "string") entry.newPassword = newPassword;
  return ok(await served(engine, "ac_passwords_update", originalProfile(profile), entry));
}
