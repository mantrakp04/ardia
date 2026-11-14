const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LARGEST_STORED_BLOCK = 65535;

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function zlibStored(data: Uint8Array): Uint8Array {
  const parts: (Uint8Array | number[])[] = [[0x78, 0x01]];
  for (let at = 0; at < data.length || at === 0; at += LARGEST_STORED_BLOCK) {
    const block = data.subarray(at, at + LARGEST_STORED_BLOCK);
    const last = at + LARGEST_STORED_BLOCK >= data.length;
    parts.push([last ? 1 : 0, block.length & 0xff, block.length >>> 8, ~block.length & 0xff, (~block.length >>> 8) & 0xff], block);
    if (last) break;
  }
  parts.push(u32(adler32(data)));
  return concat(parts);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([[...type].map((c) => c.charCodeAt(0)), data]);
  return concat([u32(data.length), typed, u32(crc32(typed))]);
}

export function grayscalePng(width: number, height: number, shade: (x: number, y: number) => number): Uint8Array {
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = shade(x, y);
  const header = new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0]);
  return concat([[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", header), chunk("IDAT", zlibStored(rows)), chunk("IEND", new Uint8Array(0))]);
}

export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : BASE64[c & 63]!;
  }
  return out;
}
