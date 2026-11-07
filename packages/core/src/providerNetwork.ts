import { providerUrl } from "./providerRows.ts";

const LOOPBACK_TEST_HOST = "127.0.0.1";
const PRIVATE_SUFFIXES = /\.(?:localhost|local|internal|lan|home\.arpa|test|invalid|onion)$/i;
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/;
const AUTHORITY = /^([a-z]+):\/\/([^/?#]*)(?:[/?#]|$)/i;

export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!DNS_NAME.test(h)) return false;
  const bare = h.replace(/\.$/, "");
  return bare !== "localhost" && !PRIVATE_SUFFIXES.test(bare);
}

function plainAuthority(url: string): { scheme: string; host: string } | null {
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return null;
  const found = AUTHORITY.exec(url);
  if (!found) return null;
  const scheme = found[1]!.toLowerCase();
  const authority = found[2]!;
  if (authority.includes("@") || authority.includes("%") || authority.startsWith("[")) return null;
  const colon = authority.indexOf(":");
  const host = colon < 0 ? authority : authority.slice(0, colon);
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || port === (scheme === "https" ? "443" : "80")) return null;
  }
  return { scheme, host };
}

export function remoteRequestAllowed(url: string, { allowLoopback = false }: { allowLoopback?: boolean } = {}): boolean {
  if (!providerUrl(url)) return false;
  const parts = plainAuthority(url);
  if (!parts) return false;
  if (parts.scheme === "https" && isPublicHost(parts.host)) return true;
  return allowLoopback && parts.host === LOOPBACK_TEST_HOST;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 255);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let at = 0; at < bytes.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[at + i * 4]! << 24) | (bytes[at + i * 4 + 1]! << 16) | (bytes[at + i * 4 + 2]! << 8) | bytes[at + i * 4 + 3]!;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }
    let [a, b, c, d, e, f, g, k] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] = h[i]! + v));
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, "0")).join("");
}

export const providerApprovalKey = (definition: unknown) => `omnibox-provider:${sha256Hex(canonical(definition))}`;
