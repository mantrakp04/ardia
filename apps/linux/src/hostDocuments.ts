import { readCanonicalLiveDocument } from "./canonicalLiveDocument";
import type { ArdiaHost } from "./host";
import { invokeHost } from "./host.ts";

export function createHostDocuments(host: ArdiaHost) {
  const documents = new Map(Object.entries(host.bootstrap.documents ?? {}));
  let writes = Promise.resolve();
  const invoke = (method: string, args: unknown[]) => {
    const next = writes.catch(() => {}).then(() => invokeHost<void>(`ArdiaShell.${method}`, { args }, host));
    writes = next;
    return next;
  };
  const restore = (name: string, previous: string | undefined) => {
    if (previous === undefined) documents.delete(name);
    else documents.set(name, previous);
  };
  return {
    read: (name: string) => name === "live.canonical.json" ? null : name === "live.json" ? readCanonicalLiveDocument(host) : documents.get(name) ?? null,
    write: (name: string, contents: string) => {
      if (name === "live.json" || name === "live.canonical.json") return Promise.reject(Object.assign(new Error("Canonical Live documents require typed operations"), { code: "ERR_DOCUMENT_RESERVED" }));
      const previous = documents.get(name);
      documents.set(name, contents);
      return invoke("writeDocument", [name, contents]).catch((error) => {
        if (documents.get(name) === contents) restore(name, previous);
        throw error;
      });
    },
    refresh: async (name: string) => {
      if (name === "live.json" || name === "live.canonical.json") return false;
      await writes.catch(() => {});
      const contents = await invokeHost<unknown>("ArdiaShell.readDocument", { args: [name] }, host);
      if (typeof contents === "string") documents.set(name, contents);
      else if (contents === null) documents.delete(name);
      else throw Object.assign(new Error(`Unexpected stored document reply for ${name}`), { code: "ERR_BAD_REPLY" });
      return typeof contents === "string";
    },
    remove: (name: string) => {
      if (name === "live.json" || name === "live.canonical.json") return Promise.reject(Object.assign(new Error("Canonical Live documents cannot be removed generically"), { code: "ERR_DOCUMENT_RESERVED" }));
      const previous = documents.get(name);
      documents.delete(name);
      return invoke("removeDocument", [name]).catch((error) => {
        if (!documents.has(name)) restore(name, previous);
        throw error;
      });
    },
  };
}
