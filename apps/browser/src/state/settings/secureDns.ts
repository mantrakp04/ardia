import { getSecureDns, onSecureDnsChange, probeSecureDns, setSecureDns, type SecureDnsProvider, type SecureDnsState } from "../../platform/secureDns";
import { noteSecureDns } from "../telemetry/usage";
import { load, resource, store } from "./resources";
import type { SecureDnsChoice } from "./secureDnsChoice";

export type { SecureDnsProvider, SecureDnsState };
export { secureDnsChoice, secureDnsEditableTemplates, secureDnsHosts, secureDnsLocked, type SecureDnsChoice } from "./secureDnsChoice";

export type CustomCheck = "ok" | "invalid" | "unverified" | "cancelled" | "failed";

export const secureDns = resource("secureDns", (): Promise<SecureDnsState | null> => getSecureDns().catch(() => null));

const keep = (state: SecureDnsState) => {
  store(secureDns, [], state);
  return state;
};

const saved = (write: Promise<SecureDnsState>) =>
  write.then(
    (state) => (noteSecureDns("secureDnsSaves"), keep(state)),
    (error: unknown) => {
      noteSecureDns("secureDnsSaveFailures");
      throw error;
    },
  );

export function chooseSecureDns(choice: Exclude<SecureDnsChoice, { kind: "custom" }>): Promise<SecureDnsState> {
  if (choice.kind === "provider") return saved(setSecureDns("secure", choice.provider.templates));
  return saved(setSecureDns(choice.kind === "network" ? "automatic" : "off"));
}

export const saveCustomSecureDns = (templates: string) => saved(setSecureDns("secure", templates.trim()));

export const reloadSecureDns = () => load(secureDns, [], { fresh: true }).catch(() => null);

export const watchSecureDns = () => onSecureDnsChange(() => void reloadSecureDns());

export async function checkCustomSecureDns(templates: string): Promise<CustomCheck> {
  const probe = await probeSecureDns(templates.trim()).catch(() => null);
  if (!probe) return "failed";
  if ("cancelled" in probe) return "cancelled";
  noteSecureDns(!probe.valid ? "secureDnsProbeInvalid" : probe.ok ? "secureDnsProbesOk" : "secureDnsProbesUnverified");
  if (!probe.valid) return "invalid";
  return probe.ok ? "ok" : "unverified";
}
