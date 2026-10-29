import type { ArdiaHost } from "./host";

export function startUtilityNavigation(host: ArdiaHost, navigate: (value: unknown) => void) {
  let version = 0;
  let stopped = false;
  navigate(host.bootstrap.utility);
  const stopEvents = host.onEvent((module, event, value) => {
    if (stopped || module !== "ArdiaShell" || event !== "onUtilityNavigation") return;
    version++;
    navigate(value);
  });
  const requestedVersion = version;
  const ready = host.invoke("ArdiaShell.utilityReady", { args: [host.bootstrap.windowId] }).then((place) => {
    if (!stopped && requestedVersion === version) navigate(place);
  });
  return { ready, stop: () => { stopped = true; stopEvents(); } };
}
