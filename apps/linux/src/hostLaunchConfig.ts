import type { LaunchConfig } from "../../../packages/shell/src/app";
import type { ArdiaHost } from "./host";

export function hostLaunchConfig(host?: ArdiaHost): LaunchConfig {
  const config = host?.bootstrap.launchConfig;
  return {
    dataDirectory: typeof config?.dataDirectory === "string" ? config.dataDirectory : null,
    background: config?.background === true,
    isolated: config?.isolated === true,
    testInstance: false,
    instance: { ...config?.instance },
    switches: { ...config?.switches, newTabPrewarm: false },
    trace: [],
    test: {},
  };
}
