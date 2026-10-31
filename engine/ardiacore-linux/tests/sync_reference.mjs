import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAGIC = Buffer.from("NNS1");
const SALT = "netnyahoo-sync/v1";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function base32(bytes) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

export function keysFor(entropy) {
  const derive = (info) => Buffer.from(hkdfSync("sha256", entropy, SALT, info, 32));
  const fileKey = derive("file-key");
  const nameKey = derive("name-key");
  const passwordKey = derive("password-key");
  const passwordNonceKey = derive("password-nonce-key");
  const tag = (label) => base32(createHmac("sha256", nameKey).update(label).digest().subarray(0, 16));
  const chain = tag("chain");
  const scopeTag = (scope) => tag(`scope/${scope}`);
  const frame = (payload, padding) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(payload.length);
    const plain = Buffer.concat([head, payload]);
    return Buffer.concat([plain, Buffer.alloc((padding - (plain.length % padding)) % padding)]);
  };
  const unframe = (plain) => {
    const length = plain.readUInt32BE(0);
    if (length > plain.length - 4) throw new Error("format");
    return plain.subarray(4, 4 + length);
  };
  const fileAad = (scope, file) => Buffer.concat([MAGIC, Buffer.from(`${chain}/${scope}/${file}`)]);
  const passwordAad = (origin, username) => {
    const o = Buffer.from(origin);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(o.length);
    return Buffer.concat([MAGIC, Buffer.from("password/"), length, o, Buffer.from(username)]);
  };
  const gcm = (key, nonce, aad, plain) => {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  };
  const ungcm = (key, nonce, aad, body) => {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  };
  return {
    chain,
    scopeTag,
    seal(payload, scope, file, nonce = randomBytes(12)) {
      return Buffer.concat([MAGIC, nonce, gcm(fileKey, nonce, fileAad(scope, file), frame(Buffer.from(payload), 1024))]);
    },
    open(data, scope, file) {
      if (data.length < 36 || !data.subarray(0, 4).equals(MAGIC)) throw new Error("format");
      return unframe(ungcm(fileKey, data.subarray(4, 16), fileAad(scope, file), data.subarray(16))).toString("utf8");
    },
    sealPassword(password, origin, username) {
      const plain = frame(Buffer.from(password), 32);
      const aad = passwordAad(origin, username);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(aad.length);
      const nonce = createHmac("sha256", passwordNonceKey).update(Buffer.concat([length, aad, plain])).digest().subarray(0, 12);
      return Buffer.concat([Buffer.from([1]), nonce, gcm(passwordKey, nonce, aad, plain)]).toString("base64");
    },
    openPassword(sealed, origin, username) {
      const data = Buffer.from(sealed, "base64");
      if (data[0] !== 1) throw new Error("format");
      return unframe(ungcm(passwordKey, data.subarray(1, 13), passwordAad(origin, username), data.subarray(13))).toString("utf8");
    },
  };
}

export function phraseWords(entropy, wordlist) {
  const checksum = createHash("sha256").update(entropy).digest()[0];
  const bits = [...entropy, checksum].flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => (byte >> shift) & 1));
  const words = [];
  for (let i = 0; i < 24; i++) words.push(wordlist[bits.slice(i * 11, i * 11 + 11).reduce((n, bit) => (n << 1) | bit, 0)]);
  return words;
}

export function wordlistFrom(source) {
  const words = [...readFileSync(source, "utf8").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  if (words.length !== 2048) throw new Error(`wordlist has ${words.length} words`);
  return words;
}

function generate(dir, wordlistSource) {
  const entropy = randomBytes(32);
  const keys = keysFor(entropy);
  const files = [];
  for (const [scope, payload] of [
    ["app", JSON.stringify({ v: 1, kind: "log", device: "reference", seq: 1, at: 1, ops: [{ k: "set:theme", h: "h", v: { v: "dark" } }] })],
    ["p:reference-profile", JSON.stringify({ v: 1, kind: "snapshot", device: "reference", at: 2, vv: {}, seen: {}, records: {} })],
    ["p:reference-profile", "x".repeat(3000)],
  ]) {
    const id = base32(randomBytes(16));
    const nonce = randomBytes(12);
    const folder = join(dir, "folder", keys.chain, keys.scopeTag(scope));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${id}.nns`), keys.seal(payload, keys.scopeTag(scope), id, nonce));
    files.push({ scope, id, payload, nonce: nonce.toString("hex") });
  }
  const passwords = [["https://reference.example", "ref", `reference-${randomBytes(8).toString("hex")}-✓`], ["https://empty.example", "", ""]].map(([origin, username, password]) => ({
    origin,
    username,
    password,
    sealed: keys.sealPassword(password, origin, username),
  }));
  const manifest = {
    entropy: entropy.toString("hex"),
    chain: keys.chain,
    appScope: keys.scopeTag("app"),
    phrase: phraseWords(entropy, wordlistFrom(wordlistSource)).join(" "),
    files,
    passwords,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
  });
}

function verify(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const keys = keysFor(Buffer.from(manifest.entropy, "hex"));
  for (const file of manifest.files) {
    const path = join(dir, "folder", keys.chain, keys.scopeTag(file.scope), `${file.id}.nns`);
    const opened = keys.open(readFileSync(path), keys.scopeTag(file.scope), file.id);
    if (opened !== file.payload) throw new Error(`payload mismatch for ${file.id}`);
  }
  for (const login of manifest.passwords) {
    if (keys.openPassword(login.sealed, login.origin, login.username) !== login.password) throw new Error("password mismatch");
    if (keys.sealPassword(login.password, login.origin, login.username) !== login.sealed) throw new Error("password seal differs");
  }
  for (const path of walk(join(dir, "folder"))) {
    for (const secret of ["Linux Secret Title", "secret-bookmark", "linux-profile", ...manifest.passwords.map((login) => login.password)]) {
      if (path.includes(secret)) throw new Error(`plaintext in ${path}`);
      if (statSync(path).isFile() && readFileSync(path).includes(secret)) throw new Error(`plaintext in ${path}`);
    }
  }
  console.log(`reference verified ${manifest.files.length} Linux files and ${manifest.passwords.length} passwords`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, dir, wordlistSource] = process.argv.slice(2);
  if (command === "generate") generate(dir, wordlistSource);
  else if (command === "verify") verify(dir);
  else throw new Error(`unknown command ${command}`);
}
