import { createHmac, timingSafeEqual } from "node:crypto";

export const UPLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function signature(secret, id, expiresSec) {
  return createHmac("sha256", secret).update(`ardia-feedback-upload:${id}:${expiresSec}`).digest();
}

export function issueUploadToken(secret, id, expiresAtMs) {
  const expiresSec = Math.floor(expiresAtMs / 1000);
  return `${id}.${expiresSec}.${signature(secret, id, expiresSec).toString("base64url")}`;
}

export function uploadTokenProblem(secret, token, id, nowMs = Date.now()) {
  if (typeof token !== "string" || token === "") return "missing";
  const parts = token.split(".");
  if (parts.length !== 3) return "malformed";
  const [tokenId, expires, sig] = parts;
  if (!/^[0-9]{1,12}$/.test(expires) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return "malformed";
  const expected = signature(secret, tokenId, Number(expires));
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  if (tokenId !== id) return "other_report";
  if (Number(expires) * 1000 <= nowMs) return "expired";
  return null;
}

export function bearerToken(header) {
  const match = /^Bearer ([A-Za-z0-9._-]{1,256})$/.exec(String(header ?? ""));
  return match ? match[1] : null;
}
