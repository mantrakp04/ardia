import { randomInt } from "node:crypto";

export const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ID_PATTERN = /^FB-[2-9A-HJ-NP-Z]{4,5}$/;
const SHORT_ATTEMPTS = 8;
const LONG_ATTEMPTS = 8;

export function randomId(length) {
  let id = "FB-";
  for (let i = 0; i < length; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

export async function newId(isTaken) {
  for (let attempt = 0; attempt < SHORT_ATTEMPTS + LONG_ATTEMPTS; attempt++) {
    const id = randomId(attempt < SHORT_ATTEMPTS ? 4 : 5);
    if (!(await isTaken(id))) return id;
  }
  throw new Error("feedback: no free reference id after 16 tries");
}

export function normalizeId(raw) {
  const id = String(raw ?? "").toUpperCase();
  return ID_PATTERN.test(id) ? id : null;
}
