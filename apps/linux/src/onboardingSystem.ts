import type { LinuxCapabilities } from "./hostCapabilities";

export type OnboardingSystem = { isDefault: boolean; loginEnabled: boolean };
type Probes = { isDefaultBrowser(): Promise<boolean>; launchAtLoginStatus(): Promise<string> };

export const DEFAULT_BROWSER_ELSEWHERE = "To open links from other apps here, choose Ardia as the web browser in your desktop's default applications settings.";

export function readOnboardingSystem(capabilities: Pick<LinuxCapabilities, "defaultBrowser" | "launchAtLogin">, probes: Probes): Promise<OnboardingSystem> {
  return Promise.all([
    capabilities.defaultBrowser ? probes.isDefaultBrowser().catch(() => false) : false,
    capabilities.launchAtLogin ? probes.launchAtLoginStatus().then((status) => status === "enabled", () => false) : false,
  ]).then(([isDefault, loginEnabled]) => ({ isDefault, loginEnabled }));
}
