import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { approveOmniboxProvider, useProviderApprovalRevision } from "../omnibox/providerApproval";
import { approveRule, approvedRules, pendingRules, removeRule, useAutomationApprovals, type ApprovalRule } from "./approvals";
import { pendingProviderRows } from "./omniboxApprovals";

export type AutomationRuleRow = ApprovalRule & { providerKey?: string };

export function useAutomationRules(): { pending: AutomationRuleRow[]; approved: AutomationRuleRow[] } {
  const store = useAutomationApprovals(useShallow((s) => ({ loaded: s.loaded, approved: s.approved, dismissed: s.dismissed, offered: s.offered })));
  const providers = useBrowser((s) => s.settings.omniboxProviders);
  const revision = useProviderApprovalRevision((s) => s.revision);
  return useMemo(() => {
    const dismissed = new Set(store.dismissed);
    return {
      pending: [...pendingRules(store), ...pendingProviderRows().filter((r) => !dismissed.has(r.key))],
      approved: approvedRules(store),
    };
  }, [store, providers, revision]);
}

export function approveAutomationRule(row: AutomationRuleRow) {
  if (row.providerKey) approveOmniboxProvider(row.providerKey);
  else approveRule(row.key);
}

export const removeAutomationRule = (row: AutomationRuleRow) => removeRule(row.key);
