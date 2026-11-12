import { createServerFn } from "@tanstack/react-start";
import { requireAllowed } from "./api";
import { emailKey, normalizedEmail } from "../server/testflight-signups";

export const getTestflightSignups = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { fresh?: boolean } | undefined) => ({ fresh: input?.fresh === true }))
  .handler(async ({ data }) => {
    const { listTestflightSignups } = await import("../server/testflight");
    return listTestflightSignups(data.fresh);
  });

export const removeTestflightSignup = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { email: string }) => {
    const email = typeof input?.email === "string" ? emailKey(input.email) : "";
    if (!normalizedEmail(email)) throw new Error("Not an email on the list");
    return { email };
  })
  .handler(async ({ data }) => {
    const { removeTestflightSignup: remove } = await import("../server/testflight");
    return remove(data.email);
  });

export const clearTestflightJunk = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .handler(async () => {
    const { clearTestflightJunk: clear } = await import("../server/testflight");
    return clear();
  });
