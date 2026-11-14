import type { LiveConfig } from "./store";
import type { ProfileAccounts } from "./types";

export function withLegacyAuth(accounts: unknown, config: unknown): ProfileAccounts {
  const flat = (accounts ?? {}) as ProfileAccounts;
  const saved = (config ?? {}) as Partial<LiveConfig>;
  const auth: ProfileAccounts = { ...flat };
  if (flat.bitbucket) auth.bitbucket = { ...flat.bitbucket, user: saved.bitbucketUser ?? "" };
  if (flat.confluence) auth.confluence = { ...flat.confluence, user: saved.confluenceEmail ?? "", site: saved.confluenceSite ?? "" };
  if (flat.gdrive) auth.gdrive = { ...flat.gdrive, clientId: saved.googleClientId ?? "" };
  return auth;
}
