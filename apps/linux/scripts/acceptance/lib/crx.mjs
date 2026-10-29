import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function zipEntries(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("no end of central directory");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central entry ${i}`);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({ name, data: zip.subarray(dataAt, dataAt + size), crc: zip.readUInt32LE(at + 16) });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

function varint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

const field = (number, bytes) => Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);

export function readFields(buffer) {
  const fields = [];
  let at = 0;
  const read = () => {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = buffer[at++];
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return value;
      scale *= 128;
    }
  };
  while (at < buffer.length) {
    const tag = read();
    if (tag % 8 !== 2) throw new Error(`unsupported wire type ${tag % 8}`);
    const length = read();
    fields.push({ number: Math.floor(tag / 8), bytes: buffer.subarray(at, at + length) });
    at += length;
  }
  return fields;
}

export function extensionId(publicKeyDer) {
  return [...createHash("sha256").update(publicKeyDer).digest().subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
}

export async function unpackedExtensionId(directory) {
  return extensionId(Buffer.from(await realpath(directory), "utf8"));
}

export function crxKey() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, publicKeyDer: publicKey.export({ type: "spki", format: "der" }) };
}

export function crxSignedPayload(signedHeaderData, archive) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedHeaderData.length, 0);
  return Buffer.concat([Buffer.from("CRX3 SignedData\0", "latin1"), size, signedHeaderData, archive]);
}

export function packCrx(archive, key) {
  const crxId = createHash("sha256").update(key.publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = field(1, crxId);
  const signature = sign("sha256", crxSignedPayload(signedHeaderData, archive), key.privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, key.publicKeyDer), field(2, signature)])), field(10000, signedHeaderData)]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, archive]);
}

export function parseCrx(crx) {
  if (crx.subarray(0, 4).toString("latin1") !== "Cr24" || crx.readUInt32LE(4) !== 3) throw new Error("not a CRX3 file");
  const size = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + size);
  const archive = crx.subarray(12 + size);
  const fields = readFields(header);
  const proof = readFields(fields.find((f) => f.number === 2).bytes);
  const signed = fields.find((f) => f.number === 10000).bytes;
  return { publicKeyDer: proof.find((f) => f.number === 1).bytes, signature: proof.find((f) => f.number === 2).bytes, signedHeaderData: signed, crxId: readFields(signed).find((f) => f.number === 1).bytes, archive };
}

async function folderEntries(dir) {
  const out = [];
  const walk = async (here) => {
    for (const entry of (await readdir(here, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(here, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out.push({ name: relative(dir, path).split(sep).join("/"), data: await readFile(path) });
    }
  };
  await walk(dir);
  return out;
}

export async function writeCrx(dir, file, key) {
  const crx = packCrx(storedZip(await folderEntries(dir)), key);
  await writeFile(file, crx);
  return { file, id: extensionId(key.publicKeyDer) };
}
