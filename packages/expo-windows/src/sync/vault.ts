import type { Listing, SyncNative } from "@ardia/sync";
import { isTag } from "./base32";

export const FILE_EXTENSION = ".nns";

export type VaultEntry = { name: string; dir: boolean; modified: number; placeholder: boolean };

export type Opened = { state: "data"; payload: string } | { state: "busy" | "placeholder" | "missing" | "damaged" | "unreadable" };

export type SyncContract = NonNullable<typeof SyncNative>;

export type VaultNative = Pick<SyncContract, "chainStatus" | "write"> & {
  createChain(folder: string): Promise<unknown>;
  deleteChain(folder: string): Promise<unknown>;
  list(folder: string, scope: string): Promise<string | null>;
  open(folder: string, scope: string, id: string): Promise<Opened>;
  remove(folder: string, scope: string, id: string): Promise<string>;
  hydrate(folder: string, scope: string, id: string): void;
};

export type SyncFileCounts = ReturnType<NonNullable<SyncContract["takeFileCounts"]>>;

export type FileCounts = Omit<SyncFileCounts, "hydrated">;

export const FOLDER_UNREADABLE = "ERR_SYNC_FOLDER_UNREADABLE";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function folderUnreadable(error: unknown): Error & { code: string } {
  return Object.assign(new Error(`The sync folder couldn't be read: ${reason(error)}`), { code: FOLDER_UNREADABLE });
}

export class RemoveFailed extends Error {
  readonly ids: string[];

  constructor(ids: string[]) {
    super(`Couldn't remove ${ids.length} sync file${ids.length === 1 ? "" : "s"}`);
    this.ids = ids;
  }
}

const entriesOf = (json: string): VaultEntry[] => {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? (parsed as VaultEntry[]) : [];
};

const byName = (a: VaultEntry, b: VaultEntry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function syncVault(native: VaultNative, counts: FileCounts) {
  return {
    chainStatus: (folder: string) => native.chainStatus(folder),
    createChain: async (folder: string) => void (await native.createChain(folder)),
    deleteChain: async (folder: string) => void (await native.deleteChain(folder)),
    write: (folder: string, scope: string, payload: string) => native.write(folder, scope, payload),

    async remove(folder: string, scope: string, ids: string[]) {
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await native.remove(folder, scope, id);
        } catch {
          failed.push(id);
        }
      }
      if (failed.length) throw new RemoveFailed(failed);
    },

    async read(folder: string, scope: string, known: string[], now = Date.now()): Promise<Listing> {
      const listing: Listing = { files: [], pending: [], damaged: [], present: [] };
      let listed: string | null;
      try {
        listed = await native.list(folder, scope);
      } catch (error) {
        throw folderUnreadable(error);
      }
      if (listed === null) return listing;
      const skip = new Set(known);
      const seen = new Set<string>();
      for (const entry of entriesOf(listed).sort(byName)) {
        if (entry.dir || !entry.name.endsWith(FILE_EXTENSION)) continue;
        const id = entry.name.slice(0, -FILE_EXTENSION.length);
        if (!isTag(id) || seen.has(id)) continue;
        seen.add(id);
        if (skip.has(id)) {
          listing.present.push(id);
          continue;
        }
        const opened: Opened = entry.placeholder ? { state: "placeholder" } : await native.open(folder, scope, id);
        if (opened.state === "missing") continue;
        listing.present.push(id);
        if (opened.state === "data") listing.files.push({ id, payload: opened.payload });
        else if (opened.state === "damaged") listing.damaged.push({ id, age: Math.max(0, now - entry.modified) });
        else if (opened.state === "unreadable") listing.damaged.push({ id, age: 0 });
        else {
          listing.pending.push(id);
          if (opened.state === "busy") counts.busy++;
          else {
            counts.placeholders++;
            native.hydrate(folder, scope, id);
          }
        }
      }
      return listing;
    },
  };
}
