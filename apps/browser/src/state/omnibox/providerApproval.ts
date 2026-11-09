import { create } from "zustand";

export type ProviderApprovalSource = {
  isApproved(key: string): boolean;
  approve(key: string): void;
  revoke(key: string): void;
  subscribe(listener: () => void): () => void;
};

export const useProviderApprovalRevision = create<{ revision: number }>()(() => ({ revision: 0 }));

const bump = () => useProviderApprovalRevision.setState((s) => ({ revision: s.revision + 1 }));

function sessionApprovals(): ProviderApprovalSource {
  const approved = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  return {
    isApproved: (key) => approved.has(key),
    approve: (key) => void (approved.add(key) && changed()),
    revoke: (key) => void (approved.delete(key) && changed()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let source: ProviderApprovalSource = sessionApprovals();
let unsubscribe = source.subscribe(bump);

export function setProviderApprovalSource(next: ProviderApprovalSource) {
  unsubscribe();
  source = next;
  unsubscribe = source.subscribe(bump);
  bump();
}

export const isProviderApproved = (key: string) => source.isApproved(key);

export const approveOmniboxProvider = (key: string) => source.approve(key);

export const revokeOmniboxProvider = (key: string) => source.revoke(key);
