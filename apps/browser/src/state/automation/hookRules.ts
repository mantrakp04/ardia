import { create } from "zustand";
import { readConfigFile } from "../../platform/configFolder";
import { useBrowser } from "../browser/store";
import { showToast } from "../app/toasts";
import { focusedWindowOf } from "../windows/ui";
import { offerRules, useAutomationApprovals, type ApprovalRule, type ApprovalSource } from "./approvals";
import { HOOKS_FILE, parseHooksText, type HookSpec } from "./hookFile";
import { approvalFor, isHookActive, launchActionApproval } from "./hookPolicy";
import type { DecideEvent } from "./eventNames";

type Store = { hooks: HookSpec[]; generation: number; problems: string[]; stamp: string | null };

export const useHookRules = create<Store>()(() => ({ hooks: [], generation: 0, problems: [], stamp: null }));

const changeListeners = new Set<() => void>();
let unshownNotice = false;

export const onHooksChanged = (listener: () => void) => {
  changeListeners.add(listener);
  return () => void changeListeners.delete(listener);
};

function noticePending(source: ApprovalSource, fresh: ApprovalRule[]) {
  if (!fresh.length) return;
  const s = useBrowser.getState();
  const windowId = focusedWindowOf(s) ?? s.windowOrder[0];
  if (!windowId) return void (unshownNotice = true);
  unshownNotice = false;
  const what = fresh.length === 1 ? `“${fresh[0]!.name}” waits` : `${fresh.length} automation rules wait`;
  showToast(windowId, `${source}: ${what} for your approval`, "Settings › Advanced › Automation", { icon: "lock.shield" });
}

export function showPendingNotice() {
  if (unshownNotice) noticePending(HOOKS_FILE, useHookRules.getState().hooks.map(approvalFor).filter((r): r is ApprovalRule => !!r));
}

function applyHooks(hooks: HookSpec[], problems: string[], stamp: string | null) {
  const before = useHookRules.getState();
  const same = before.hooks.length === hooks.length && before.hooks.every((h, i) => h.revision === hooks[i]!.revision && h.name === hooks[i]!.name);
  useHookRules.setState({ hooks, problems, stamp, generation: same ? before.generation : before.generation + 1 });
  noticePending(HOOKS_FILE, offerRules(HOOKS_FILE, hooks.map(approvalFor).filter((r): r is ApprovalRule => !!r)));
  if (!same) for (const listener of changeListeners) listener();
}

export function reloadHooks() {
  const read = readConfigFile(HOOKS_FILE);
  if (read.status === "missing") return applyHooks([], [], read.stamp ?? null);
  if (read.status !== "ok") {
    useHookRules.setState({ problems: [`${HOOKS_FILE} can't be read (${read.status})`] });
    return;
  }
  const parsed = parseHooksText(read.text);
  if (parsed.problems.length) {
    console.warn(`[automation] ${HOOKS_FILE}: ${parsed.problems.join("; ")}; keeping the hooks loaded before`);
    useHookRules.setState({ problems: parsed.problems });
    return;
  }
  applyHooks(parsed.hooks, [], read.stamp ?? null);
}

export function setHooksForTests(hooks: HookSpec[]) {
  applyHooks(hooks, [], null);
}

export function decideHooks(event: DecideEvent): HookSpec[] {
  return useHookRules.getState().hooks.filter((h) => h.decide === event);
}

export const activeHook = (hook: HookSpec) => isHookActive(hook);

export function hookNamed(name: string, revision: string): HookSpec | null {
  return useHookRules.getState().hooks.find((h) => h.name === name && h.revision === revision) ?? null;
}

export function offerLaunchActions(entries: readonly string[]) {
  noticePending("config.json", offerRules("config.json", entries.map(launchActionApproval).filter((r): r is ApprovalRule => !!r)));
}

let watching = false;

export function startHookRules() {
  if (watching) return;
  watching = true;
  reloadHooks();
  useAutomationApprovals.subscribe((s, prev) => {
    if (s.approved !== prev.approved) for (const listener of changeListeners) listener();
  });
}
