import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";

export const COMPOSITORS = ["sway", "weston", "cage"];

export async function which(name, path = process.env.PATH ?? "") {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export async function findCompositor({ path, prefer = COMPOSITORS } = {}) {
  for (const name of prefer) {
    const found = await which(name, path);
    if (found) return { name, path: found };
  }
  return null;
}
