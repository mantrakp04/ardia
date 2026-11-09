import { anonymousIdentity } from "../../../../packages/core/src/anonymousIdentity.ts";

export type Identity = ReturnType<typeof anonymousIdentity>;

const memo = new Map<string, Identity>();

export function identityOf(id: string): Identity {
  let found = memo.get(id);
  if (!found) {
    found = anonymousIdentity(id);
    if (memo.size > 20_000) memo.clear();
    memo.set(id, found);
  }
  return found;
}

export const shortId = (id: string) => id.slice(0, 8);

export const INSTALL_ID = /^[0-9a-zA-Z][0-9a-zA-Z_-]{5,63}$/;
