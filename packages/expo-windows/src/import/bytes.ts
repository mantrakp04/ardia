const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DECODE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let count = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    bits = (bits << 6) | (DECODE[clean.charCodeAt(i)] ?? 0);
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[o++] = (bits >> count) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

export function utf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const a = bytes[i++]!;
    let code = 0xfffd;
    if (a < 0x80) code = a;
    else if (a >= 0xc2 && a < 0xe0 && i < bytes.length) code = ((a & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    else if (a >= 0xe0 && a < 0xf0 && i + 1 < bytes.length) code = ((a & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    else if (a >= 0xf0 && a < 0xf5 && i + 2 < bytes.length)
      code = ((a & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    out += String.fromCodePoint(code);
  }
  return out;
}

export function utf16le(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  return out;
}

export class ByteReader {
  offset = 0;
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get remaining() {
    return this.bytes.length - this.offset;
  }

  take(n: number): Uint8Array | undefined {
    if (n < 0 || this.remaining < n) return undefined;
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  skip(n: number) {
    return this.take(n) !== undefined;
  }

  private little(n: number): number | undefined {
    const b = this.take(n);
    if (!b) return undefined;
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + b[i]!;
    return v;
  }

  u8 = () => this.little(1);
  u16 = () => this.little(2);
  u32 = () => this.little(4);
  i32 = () => {
    const v = this.little(4);
    return v === undefined ? undefined : v | 0;
  };
  hex64 = () => {
    const b = this.take(8);
    if (!b) return undefined;
    let out = "";
    for (let i = 7; i >= 0; i--) out += b[i]!.toString(16).toUpperCase().padStart(2, "0");
    return out;
  };
  i64 = () => {
    const low = this.little(4);
    const high = this.little(4);
    if (low === undefined || high === undefined) return undefined;
    return (high | 0) * 4294967296 + low;
  };
}

export class Pickle {
  readonly reader: ByteReader;

  constructor(bytes: Uint8Array) {
    this.reader = new ByteReader(bytes);
    this.reader.u32();
  }

  private align() {
    const pad = (4 - (this.reader.offset % 4)) % 4;
    this.reader.skip(Math.min(pad, this.reader.remaining));
  }

  i32 = () => this.reader.i32();
  u32 = () => this.reader.u32();
  hex64 = () => this.reader.hex64();
  bool = () => {
    const v = this.reader.i32();
    return v === undefined ? undefined : v !== 0;
  };

  string(): string | undefined {
    const n = this.reader.i32();
    if (n === undefined || n < 0) return undefined;
    const b = this.reader.take(n);
    if (!b) return undefined;
    this.align();
    return utf8(b);
  }

  string16(): string | undefined {
    const n = this.reader.i32();
    if (n === undefined || n < 0) return undefined;
    const b = this.reader.take(n * 2);
    if (!b) return undefined;
    this.align();
    return utf16le(b);
  }
}

export function lz4Block(source: Uint8Array, size: number): Uint8Array | undefined {
  const out = new Uint8Array(size);
  let s = 0;
  let o = 0;
  while (s < source.length) {
    const token = source[s++]!;
    let literals = token >> 4;
    if (literals === 15) {
      let more = 255;
      while (more === 255 && s < source.length) literals += more = source[s++]!;
    }
    if (s + literals > source.length || o + literals > size) return undefined;
    out.set(source.subarray(s, s + literals), o);
    s += literals;
    o += literals;
    if (s >= source.length) break;
    if (s + 2 > source.length) return undefined;
    const back = source[s]! | (source[s + 1]! << 8);
    s += 2;
    if (back === 0 || back > o) return undefined;
    let length = (token & 15) + 4;
    if ((token & 15) === 15) {
      let more = 255;
      while (more === 255 && s < source.length) length += more = source[s++]!;
    }
    if (o + length > size) return undefined;
    for (let i = 0; i < length; i++, o++) out[o] = out[o - back]!;
  }
  return o === size ? out : undefined;
}

const MOZ_LZ4_MAGIC = [0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00];

export function mozLz4(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length <= 12 || !startsWith(bytes, MOZ_LZ4_MAGIC)) return undefined;
  const size = new ByteReader(bytes.subarray(8, 12)).u32();
  if (!size || size >= 1 << 30) return undefined;
  return lz4Block(bytes.subarray(12), size);
}
