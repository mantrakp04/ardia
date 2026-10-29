import type { NavigationState } from "../../../packages/ardiacore/src/pageTypes";
import type { PageResetReason } from "./hostPageLifecycle";

type HostPageHooks = {
  reset(tabId: string, reason: PageResetReason, replaced?: ReadonlySet<string>): void;
  applyTheme(tabId: string, state: NavigationState): void;
  depart(tabId: string): void;
};

let hooks: HostPageHooks | undefined;

export function setHostPageHooks(next: HostPageHooks) {
  hooks = next;
}

export function resetHostPageState(tabId: string, reason: PageResetReason, replaced?: ReadonlySet<string>) {
  hooks?.reset(tabId, reason, replaced);
}

export function applyHostPageThemeState(tabId: string, state: NavigationState) {
  hooks?.applyTheme(tabId, state);
}

export function forgetHostPageState(tabId: string) {
  hooks?.depart(tabId);
}
