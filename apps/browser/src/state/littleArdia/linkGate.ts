export type LinkSourceInfo = { bundleId: string | null; appName: string | null } | null;
export type LinkRouteChoice = { profileId: string | null; open: "tab" | "littleArdia" | "window" | null; windowId: string | null };
export type LinkGateResult = { url: string; route: LinkRouteChoice | null; decided: boolean } | null;
export type LinkGate = (url: string, source: LinkSourceInfo) => LinkGateResult | Promise<LinkGateResult>;

let gate: LinkGate | null = null;

export const setLinkGate = (next: LinkGate | null) => {
  gate = next;
};

export const linkGate = () => gate;
