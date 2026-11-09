import { create } from "zustand";
import { readDocument, writeDocument } from "../../platform/documents";
import { isFields } from "../../lib/decode";
import { parseSaved, versionedJson } from "../../lib/savedDocument";

export type ApprovalKind = "program" | "rewrite" | "route" | "folder" | "omnibox" | "omniboxProvider" | "launchAction";
export type ApprovalSource = "hooks.json" | "config.json" | "omnibox";
export type ApprovalRule = { key: string; kind: ApprovalKind; name: string; summary: string };
type Approved = ApprovalRule & { at: number };

const DOC = "automation-approvals.json";
const VERSION = 1;

type Store = {
  loaded: boolean;
  approved: Record<string, Approved>;
  dismissed: string[];
  offered: Partial<Record<ApprovalSource, ApprovalRule[]>>;
};

export const useAutomationApprovals = create<Store>()(() => ({ loaded: false, approved: {}, dismissed: [], offered: {} }));

const isRule = (v: unknown): v is Approved =>
  isFields(v) && typeof v.key === "string" && typeof v.kind === "string" && typeof v.name === "string" && typeof v.summary === "string" && typeof v.at === "number";

function load() {
  if (useAutomationApprovals.getState().loaded) return;
  let doc: ReturnType<typeof parseSaved> = null;
  try {
    doc = parseSaved(readDocument(DOC), VERSION);
  } catch {
    doc = null;
  }
  const approved: Record<string, Approved> = {};
  if (doc && isFields(doc.approved)) for (const [key, rule] of Object.entries(doc.approved)) if (isRule(rule) && rule.key === key) approved[key] = rule;
  const dismissed = doc && Array.isArray(doc.dismissed) ? doc.dismissed.filter((k): k is string => typeof k === "string") : [];
  useAutomationApprovals.setState({ loaded: true, approved, dismissed });
}

function save() {
  const { approved, dismissed } = useAutomationApprovals.getState();
  try {
    writeDocument(DOC, versionedJson({ approved, dismissed }, VERSION));
  } catch (error) {
    console.warn("[automation] couldn't save the approvals", error);
  }
}

export function isApproved(key: string): boolean {
  load();
  return !!useAutomationApprovals.getState().approved[key];
}

export function approveRule(key: string, known?: ApprovalRule) {
  load();
  const s = useAutomationApprovals.getState();
  const rule = Object.values(s.offered).flat().find((r) => r?.key === key) ?? known;
  if (!rule) return;
  useAutomationApprovals.setState({ approved: { ...s.approved, [key]: { ...rule, at: Date.now() } }, dismissed: s.dismissed.filter((k) => k !== key) });
  save();
}

export function removeRule(key: string) {
  load();
  const s = useAutomationApprovals.getState();
  const { [key]: _, ...approved } = s.approved;
  useAutomationApprovals.setState({ approved, dismissed: s.dismissed.includes(key) ? s.dismissed : [...s.dismissed, key].slice(-500) });
  save();
}

export function offerRules(source: ApprovalSource, rules: ApprovalRule[]): ApprovalRule[] {
  load();
  const s = useAutomationApprovals.getState();
  const before = new Set((s.offered[source] ?? []).map((r) => r.key));
  useAutomationApprovals.setState({ offered: { ...s.offered, [source]: rules } });
  return rules.filter((r) => !before.has(r.key) && !s.approved[r.key] && !s.dismissed.includes(r.key));
}

export function pendingRules(s: Store = useAutomationApprovals.getState()): ApprovalRule[] {
  const seen = new Set<string>();
  return Object.values(s.offered)
    .flat()
    .filter((r): r is ApprovalRule => !!r && !s.approved[r.key] && !s.dismissed.includes(r.key) && !seen.has(r.key) && !!seen.add(r.key));
}

export function approvedRules(s: Store = useAutomationApprovals.getState()): Approved[] {
  return Object.values(s.approved).sort((a, b) => a.name.localeCompare(b.name));
}

export function resetApprovalsForTests() {
  useAutomationApprovals.setState({ loaded: true, approved: {}, dismissed: [], offered: {} });
}
