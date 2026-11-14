import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAutomationApprovals } from "../automation/approvals";
import { approvalFor } from "../automation/hookPolicy";
import { useHookRules } from "../automation/hookRules";
import type { HookSpec } from "../automation/hookFile";
import { useBrowser } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import { useAirTraffic } from "./store";
import type { AirTrafficConfig, SourceApp } from "./rules";

export const useAirTrafficConfig = (): AirTrafficConfig => useAirTraffic((s) => s.config);

export const useRecentSourceApps = (): readonly SourceApp[] => useAirTraffic((s) => s.recentApps);

export type RoutableProfile = { id: string; name: string };

export function useRoutableProfiles(): RoutableProfile[] {
  const flat = useBrowser(useShallow((s) => s.profileOrder.filter((id) => s.profiles[id] && !isIncognitoProfile(id)).flatMap((id) => [id, s.profiles[id]!.name])));
  return useMemo(() => Array.from({ length: flat.length / 2 }, (_, i) => ({ id: flat[2 * i]!, name: flat[2 * i + 1]! })), [flat]);
}

export type LinkHookState = "active" | "approved" | "waiting" | "off";
export type LinkHookRow = { name: string; from: string[]; patterns: string[]; answer: string; state: LinkHookState };

function answerOf(hook: HookSpec): string {
  if (hook.program) return `asks ${hook.program[0]}`;
  if (hook.rules?.drop) return "drops it";
  const route = hook.rules?.route;
  return [route?.profile && `profile ${route.profile}`, route?.open].filter(Boolean).join(", ");
}

export function useLinkHooks(): LinkHookRow[] {
  const hooks = useHookRules((s) => s.hooks);
  const approvals = useAutomationApprovals(useShallow((s) => ({ approved: s.approved, dismissed: s.dismissed })));
  return useMemo(
    () =>
      hooks
        .filter((h) => h.decide === "link.opening")
        .map((hook) => {
          const approval = approvalFor(hook);
          const state: LinkHookState = !approval ? "active" : approvals.approved[approval.key] ? "approved" : approvals.dismissed.includes(approval.key) ? "off" : "waiting";
          return { name: hook.name, from: hook.from, patterns: hook.patterns, answer: answerOf(hook), state };
        }),
    [hooks, approvals],
  );
}
