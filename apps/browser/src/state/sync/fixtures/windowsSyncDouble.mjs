import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base32, isTag } from "../../../../../../packages/expo-windows/src/sync/base32.ts";

const MAGIC = Buffer.from("NNS1");
const SALT = Buffer.from("netnyahoo-sync/v1");
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const padded = (payload, block) => {
  const plain = Buffer.concat([u32(payload.length), payload]);
  return Buffer.concat([plain, Buffer.alloc((block - (plain.length % block)) % block)]);
};
const unpadded = (plain) => {
  const length = plain.readUInt32BE(0);
  if (length > plain.length - 4) throw new Error("format");
  return plain.subarray(4, 4 + length);
};

export const sha256 = (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());

export function cryptoDouble(entropy) {
  const key = (info) => Buffer.from(hkdfSync("sha256", entropy, SALT, Buffer.from(info), 32));
  const fileKey = key("file-key");
  const nameKey = key("name-key");
  const passwordKey = key("password-key");
  const passwordNonceKey = key("password-nonce-key");
  const tag = (label) => base32(createHmac("sha256", nameKey).update(label).digest().subarray(0, 16));
  const chainTag = tag("chain");
  const aad = (scopeTag, fileId) => Buffer.concat([MAGIC, Buffer.from(`${chainTag}/${scopeTag}/${fileId}`)]);
  const gcmSeal = (keyBytes, nonce, plain, extra) => {
    const cipher = createCipheriv("aes-256-gcm", keyBytes, nonce).setAAD(extra);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  };
  const gcmOpen = (keyBytes, box, extra) => {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes, box.subarray(0, 12)).setAAD(extra);
    decipher.setAuthTag(box.subarray(box.length - 16));
    return Buffer.concat([decipher.update(box.subarray(12, box.length - 16)), decipher.final()]);
  };
  const passwordAad = (origin, username) => {
    const o = Buffer.from(origin);
    return Buffer.concat([MAGIC, Buffer.from("password/"), u32(o.length), o, Buffer.from(username)]);
  };
  const sealPassword = (password, origin, username) => {
    const plain = padded(Buffer.from(password), 32);
    const extra = passwordAad(origin, username);
    const nonce = createHmac("sha256", passwordNonceKey).update(Buffer.concat([u32(extra.length), extra, plain])).digest().subarray(0, 12);
    return Buffer.concat([Buffer.from([1]), gcmSeal(passwordKey, nonce, plain, extra)]).toString("base64");
  };
  const openPassword = (sealed, origin, username) => {
    const data = Buffer.from(sealed, "base64");
    if (data[0] !== 1) throw new Error("format");
    return unpadded(gcmOpen(passwordKey, data.subarray(1), passwordAad(origin, username))).toString("utf8");
  };
  const rewrite = (json, hiding) => {
    if (!json.includes('"pw:') && !json.includes("\\u")) return json;
    const login = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const out = { ...value };
      const known = typeof out.o === "string" && typeof out.u === "string";
      if (hiding && known && typeof out.p === "string") {
        const s = sealPassword(out.p, out.o, out.u);
        delete out.p;
        delete out.s;
        out.s = s;
      } else if (hiding && "p" in out) delete out.p;
      else if (!hiding && known && typeof out.s === "string") {
        const p = openPassword(out.s, out.o, out.u);
        delete out.s;
        delete out.p;
        out.p = p;
      }
      return out;
    };
    const walk = (node) => {
      if (Array.isArray(node)) return node.map(walk);
      if (!node || typeof node !== "object") return node;
      if (typeof node.k === "string" && node.k.startsWith("pw:") && "v" in node) return { ...node, v: login(node.v) };
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (!k.startsWith("pw:")) out[k] = walk(v);
        else if (typeof v === "string") continue;
        else if (v && typeof v === "object" && !Array.isArray(v) && "v" in v) out[k] = { ...v, v: login(v.v) };
        else out[k] = v;
      }
      return out;
    };
    return JSON.stringify(walk(JSON.parse(json)));
  };
  const sealFile = (scopeTag, fileId, text) => Buffer.concat([MAGIC, gcmSeal(fileKey, randomBytes(12), padded(Buffer.from(text), 1024), aad(scopeTag, fileId))]);
  const openFile = (scopeTag, fileId, file) => {
    if (file.length < 36 || !file.subarray(0, 4).equals(MAGIC)) return null;
    try {
      return unpadded(gcmOpen(fileKey, file.subarray(4), aad(scopeTag, fileId))).toString("utf8");
    } catch {
      return null;
    }
  };
  const opened = (scopeTag, fileId, file) => {
    const plain = openFile(scopeTag, fileId, file);
    if (plain === null) return { state: "damaged" };
    try {
      return { state: "data", payload: rewrite(plain, true) };
    } catch {
      return { state: "unreadable" };
    }
  };
  return {
    chainTag: () => chainTag,
    scopeTag: (scope) => tag(`scope/${scope}`),
    sealPassword,
    openPassword,
    sealFile: (scopeTag, fileId, payload) => sealFile(scopeTag, fileId, rewrite(payload, false)),
    opened,
    sealLocal: (text) => sealFile("local", "state", text).toString("base64"),
    openLocal: (sealed) => opened("local", "state", Buffer.from(sealed, "base64")),
  };
}

const local = (path) => path.replaceAll("\\", "/");

export function nativeDouble(keys, { busy = new Set(), placeholders = new Set() } = {}) {
  const hydrated = [];
  const state = { localUnreadable: false };
  const chainPath = (folder) => join(local(folder), keys.chainTag());
  const scopePath = (folder, scope) => join(chainPath(folder), keys.scopeTag(scope));
  const filePath = (folder, scope, id) => {
    if (!isTag(id)) throw new Error("not a sync file id");
    return join(scopePath(folder, scope), `${id}.nns`);
  };
  const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();
  return {
    hydrated,
    state,
    async chainStatus(folder) {
      if (!isDirectory(local(folder))) return "unavailable";
      return isDirectory(chainPath(folder)) ? "ok" : "missing";
    },
    async createChain(folder) {
      mkdirSync(chainPath(folder), { recursive: true });
    },
    async deleteChain(folder) {
      rmSync(chainPath(folder), { recursive: true, force: true });
    },
    async list(folder, scope) {
      const dir = scopePath(folder, scope);
      if (!existsSync(dir)) {
        if (!isDirectory(chainPath(folder))) throw new Error("the sync folder isn't reachable");
        return null;
      }
      return JSON.stringify(
        readdirSync(dir).map((name) => {
          const s = statSync(join(dir, name));
          return { name, dir: s.isDirectory(), modified: s.mtimeMs, placeholder: placeholders.has(name) };
        }),
      );
    },
    async open(folder, scope, id) {
      const path = filePath(folder, scope, id);
      if (busy.has(`${id}.nns`)) return { state: "busy" };
      if (!existsSync(path)) return { state: "missing" };
      return keys.opened(keys.scopeTag(scope), id, readFileSync(path));
    },
    async write(folder, scope, payload) {
      if (state.localUnreadable) throw new Error("unreadable");
      if (!isDirectory(chainPath(folder))) throw new Error("the sync folder isn't reachable");
      const id = base32(randomBytes(16));
      const dir = scopePath(folder, scope);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `.${id}.nns.partial`), keys.sealFile(keys.scopeTag(scope), id, payload), { flag: "wx" });
      renameSync(join(dir, `.${id}.nns.partial`), join(dir, `${id}.nns`));
      return id;
    },
    async remove(folder, scope, id) {
      const path = filePath(folder, scope, id);
      if (!existsSync(path)) return "missing";
      rmSync(path);
      return "removed";
    },
    hydrate(folder, scope, id) {
      hydrated.push(`${scope}/${id}`);
    },
    async sealLocal(text) {
      if (state.localUnreadable) throw new Error("unreadable");
      return keys.sealLocal(text);
    },
    async openLocal(sealed) {
      const result = keys.openLocal(sealed);
      if (result.state === "unreadable") state.localUnreadable = true;
      return result.state === "data" ? result.payload : null;
    },
  };
}
