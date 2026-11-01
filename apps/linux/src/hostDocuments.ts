import { readCanonicalLiveDocument } from "./canonicalLiveDocument";
import type { ArdiaHost } from "./host";
import { invokeHost } from "./host.ts";

export function createHostDocuments(host: ArdiaHost) {
  const documents = new Map(Object.entries(host.bootstrap.documents ?? {}));
  const stored = new Map(documents);
  const latest = new Map<string, number>();
  let operations = 0;
  let writes = Promise.resolve();
  const invoke = (method: string, args: unknown[]) => {
    const next = writes.catch(() => {}).then(() => invokeHost<void>(`ArdiaShell.${method}`, { args }, host));
    writes = next;
    return next;
  };
  const keep = (map: Map<string, string>, name: string, value: string | undefined) => {
    if (value === undefined) map.delete(name);
    else map.set(name, value);
  };
  const change = (name: string, value: string | undefined, method: string, args: unknown[]) => {
    const operation = ++operations;
    latest.set(name, operation);
    keep(documents, name, value);
    return invoke(method, args).then(() => keep(stored, name, value), (error) => {
      if (latest.get(name) === operation) keep(documents, name, stored.get(name));
      throw error;
    });
  };
  return {
    read: (name: string) => name === "live.canonical.json" ? null : name === "live.json" ? readCanonicalLiveDocument(host) : documents.get(name) ?? null,
    write: (name: string, contents: string) => {
      if (name === "live.json" || name === "live.canonical.json") return Promise.reject(Object.assign(new Error("Canonical Live documents require typed operations"), { code: "ERR_DOCUMENT_RESERVED" }));
      return change(name, contents, "writeDocument", [name, contents]);
    },
    refresh: async (name: string) => {
      if (name === "live.json" || name === "live.canonical.json") return false;
      const operation = latest.get(name);
      await writes.catch(() => {});
      const contents = await invokeHost<unknown>("ArdiaShell.readDocument", { args: [name] }, host);
      if (typeof contents !== "string" && contents !== null) throw Object.assign(new Error(`Unexpected stored document reply for ${name}`), { code: "ERR_BAD_REPLY" });
      if (latest.get(name) !== operation) return documents.has(name);
      keep(stored, name, contents ?? undefined);
      keep(documents, name, contents ?? undefined);
      return typeof contents === "string";
    },
    remove: (name: string) => {
      if (name === "live.json" || name === "live.canonical.json") return Promise.reject(Object.assign(new Error("Canonical Live documents cannot be removed generically"), { code: "ERR_DOCUMENT_RESERVED" }));
      return change(name, undefined, "removeDocument", [name]);
    },
  };
}
