import { randomBytes } from "node:crypto";

export const fixtureSecret = (prefix = "", bytes = 12) => `${prefix}${randomBytes(bytes).toString("hex")}`;
