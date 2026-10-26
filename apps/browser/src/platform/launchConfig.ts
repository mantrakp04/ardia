import { launchConfig as readLaunchConfig, type LaunchConfig } from "@ardia/shell";

let config: LaunchConfig | null = null;

const current = (): LaunchConfig => (config ??= readLaunchConfig());

export const switchOverride = (name: string): boolean | undefined => current().switches[name];

const testValue = (key: string): string | null => current().test[key] ?? null;

export const devTestValue = (key: string): string | null => (typeof __DEV__ !== "undefined" && __DEV__ ? testValue(key) : null);

export const reloadLaunchConfigForTests = () => void (config = null);
