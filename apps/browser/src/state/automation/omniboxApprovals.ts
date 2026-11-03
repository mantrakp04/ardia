import { setProviderApprovalSource } from "../omnibox/providerApproval";
import { pendingOmniboxProviders } from "../omnibox/activeProviders";
import { approveRule, isApproved, removeRule, useAutomationApprovals, type ApprovalRule } from "./approvals";

const keyOf = (key: string) => `omniboxProvider:${key}`;

export type PendingProviderRow = ApprovalRule & { providerKey: string };

export function pendingProviderRows(): PendingProviderRow[] {
  return pendingOmniboxProviders().map((p) => ({
    key: keyOf(p.key),
    providerKey: p.key,
    kind: "omniboxProvider",
    name: p.title,
    summary: p.endpoint ? `Sends ${p.global ? "everything you type in the address bar" : `what you type after “${p.keyword}”`} to ${p.endpoint}` : `Address bar provider ${p.title}`,
  }));
}

let started = false;

export function startOmniboxApprovals() {
  if (started) return;
  started = true;
  setProviderApprovalSource({
    isApproved: (key) => isApproved(keyOf(key)),
    approve: (key) => {
      const row = pendingProviderRows().find((r) => r.providerKey === key);
      approveRule(keyOf(key), row ?? { key: keyOf(key), kind: "omniboxProvider", name: key.slice(0, 12), summary: "Address bar provider" });
    },
    revoke: (key) => removeRule(keyOf(key)),
    subscribe: (listener) =>
      useAutomationApprovals.subscribe((s, prev) => {
        if (s.approved !== prev.approved) listener();
      }),
  });
}
