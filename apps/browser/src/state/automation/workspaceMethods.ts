import { errorText } from "../../lib/errors";
import { useBrowser } from "../browser/store";
import { activeTabId, isIncognitoProfile } from "../browser/model";
import { noteCliEdits } from "../telemetry/usage";
import { failure, type ErrorCode, type MethodError } from "./automationMethods";
import { eligibleKind, isEligibleTab, ownEntry } from "./automationWindows";
import { parseOps, type Op } from "./workspaceOps";
import { runOp } from "./workspaceApply";
import { OpError, type Changed, type OpResult } from "./workspaceTargets";
import { groupFields, isEligibleGroup, tabNode, workspace, type GroupNode, type TabNode } from "./workspaceTree";

type Body = { result: unknown } | { error: MethodError };

const textOrNull = (value: unknown) => (value === undefined || value === null ? null : typeof value === "string" ? value : undefined);

export function workspaceMethod(params: Record<string, unknown>): Body {
  const window = textOrNull(params.window);
  const profile = textOrNull(params.profile);
  if (window === undefined || profile === undefined) return failure("bad_request", "window and profile are ids.");
  const unknown = Object.keys(params).filter((key) => key !== "window" && key !== "profile");
  if (unknown.length) return failure("bad_request", `workspace takes window and profile, not ${unknown.join(", ")}.`);
  const s = useBrowser.getState();
  if (window && !eligibleKind(s, window)) return failure("no_window", `There's no window ${window} the ardia command can use.`);
  if (profile && (!ownEntry(s.profiles, profile) || isIncognitoProfile(profile))) return failure("no_window", `There's no profile ${profile}.`);
  return { result: workspace(s, { window, profile }) };
}

export type ApplyResult = {
  ok: boolean;
  applied: number;
  results: (OpResult & { op: string })[];
  error?: { index: number; code: ErrorCode; message: string; changed?: Changed };
  tabs: TabNode[];
  groups: (Omit<GroupNode, "items"> & { tabs: string[] })[];
  windows: { id: string; activeTab: string | null }[];
};

function settledState(ops: Op[], results: OpResult[]): Pick<ApplyResult, "tabs" | "groups" | "windows"> {
  const s = useBrowser.getState();
  const tabIds = [...new Set(results.flatMap((r) => r.tabs ?? []))].filter((id) => isEligibleTab(s, id));
  const groupIds = [...new Set(results.flatMap((r) => (r.group ? [r.group] : [])))].filter((id) => isEligibleGroup(s, id));
  const windowIds = new Set([...tabIds.map((id) => s.tabs[id]!.windowId), ...groupIds.map((id) => s.groups[id]!.windowId)]);
  for (const op of ops) if (typeof op.window === "string" && eligibleKind(s, op.window)) windowIds.add(op.window);
  return {
    tabs: tabIds.map((id) => tabNode(s, id)),
    groups: groupIds.map((id) => ({ ...groupFields(s, s.groups[id]!), tabs: [...s.groups[id]!.tabIds] })),
    windows: [...windowIds].map((id) => ({ id, activeTab: activeTabId(s, id) ?? null })),
  };
}

let chain: Promise<unknown> = Promise.resolve();

async function runAll(ops: Op[], stillOn: () => boolean): Promise<ApplyResult> {
  const results: OpResult[] = [];
  let error: ApplyResult["error"];
  for (const [index, op] of ops.entries()) {
    if (!stillOn()) {
      error = { index, code: "failed", message: "Control is off." };
      break;
    }
    try {
      results.push(await runOp(results, op));
    } catch (thrown) {
      const code = thrown instanceof OpError ? thrown.code : "failed";
      const changed = thrown instanceof OpError ? thrown.changed : undefined;
      error = { index, code, message: `Operation ${index} (${op.op}): ${errorText(thrown)}`, ...(changed ? { changed } : {}) };
      break;
    }
  }
  const applied = ops.slice(0, results.length);
  noteCliEdits(applied.filter((op) => !op.op.startsWith("group.")).length, applied.filter((op) => op.op.startsWith("group.")).length, error ? 1 : 0);
  return {
    ok: !error,
    applied: results.length,
    results: results.map((r, i) => ({ op: ops[i]!.op, ...r })),
    ...(error ? { error } : {}),
    ...settledState(ops, results),
  };
}

export function applyMethod(params: Record<string, unknown>, stillOn: () => boolean): Body | Promise<Body> {
  const unknown = Object.keys(params).filter((key) => key !== "ops");
  if (unknown.length) return failure("bad_request", `apply takes ops, not ${unknown.join(", ")}.`);
  const ops = parseOps(params.ops);
  if (!Array.isArray(ops)) {
    noteCliEdits(0, 0, 1);
    return failure(ops.code, ops.message);
  }
  const run = chain.then(() => runAll(ops, stillOn));
  chain = run.catch(() => {});
  return run.then((result) => ({ result }));
}
