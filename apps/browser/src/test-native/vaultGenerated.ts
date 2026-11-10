import type { CallArgs, CallResult } from "@ardia/ardiacore";

type Listed = CallResult<"vaults.listGenerated">[number];
type FakeEntry = Listed & { password: string };

export const generatedFakes = {
  entries: [] as FakeEntry[],
  days: 7,
  saves: [] as CallArgs<"vaults.saveGenerated">[],
  copies: [] as string[],
  nextSave: null as CallResult<"vaults.saveGenerated"> | null,
};

export function resetGeneratedFakes() {
  generatedFakes.entries = [];
  generatedFakes.days = 7;
  generatedFakes.saves = [];
  generatedFakes.copies = [];
  generatedFakes.nextSave = null;
}

const listed = ({ password: _secret, ...entry }: FakeEntry): Listed => entry;
const without = (id: string) => (generatedFakes.entries = generatedFakes.entries.filter((e) => e.id !== id));

export const generatedVaultHandlers = {
  listGenerated: () => [...generatedFakes.entries].sort((a, b) => b.createdAt - a.createdAt).map(listed),
  copyGenerated: ({ id }: CallArgs<"vaults.copyGenerated">) => {
    if (!generatedFakes.entries.some((e) => e.id === id)) return { copied: false, error: "notFound" as const, clearsAfter: 0 };
    generatedFakes.copies.push(id);
    return { copied: true, clearsAfter: 90 };
  },
  saveGenerated: ({ id, provider, username }: CallArgs<"vaults.saveGenerated">) => {
    generatedFakes.saves.push(username === undefined ? { id, provider } : { id, provider, username });
    const entry = generatedFakes.entries.find((e) => e.id === id);
    if (!entry) return { saved: false, error: "notFound" };
    const name = username?.trim() || entry.username;
    if (!name) return { saved: false, error: "needsUsername" };
    const answer = generatedFakes.nextSave ?? { saved: true, item: { provider, id: `saved-${id}`, title: entry.origin, username: name, urls: [entry.origin] } };
    generatedFakes.nextSave = null;
    if (answer.saved) without(id);
    return answer;
  },
  deleteGenerated: ({ id }: CallArgs<"vaults.deleteGenerated">) => {
    const had = generatedFakes.entries.some((e) => e.id === id);
    without(id);
    return { deleted: had };
  },
  setGeneratedRetention: ({ days }: CallArgs<"vaults.setGeneratedRetention">) => ((generatedFakes.days = days), {}),
};
