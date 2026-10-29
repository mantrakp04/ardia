import { showToast as showSharedToast } from "../../browser/src/state/app/toasts";
import { policyToastTarget } from "./hostPolicies";

export * from "../../browser/src/state/app/toasts";

export function showToast(...[windowId, ...rest]: Parameters<typeof showSharedToast>) {
  const target = policyToastTarget(windowId);
  if (target) showSharedToast(target, ...rest);
}
