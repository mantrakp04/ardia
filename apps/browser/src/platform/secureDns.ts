import { call, on, type SecureDnsMode, type SecureDnsProbe, type SecureDnsProvider, type SecureDnsState } from "@ardia/ardiacore";

export type { SecureDnsMode, SecureDnsProbe, SecureDnsProvider, SecureDnsState };

export const getSecureDns = () => call("engine.secureDns");
export const setSecureDns = (mode: SecureDnsMode, templates = "") => call("engine.secureDns", { mode, templates });
export const probeSecureDns = (templates: string) => call("engine.probeSecureDns", { templates });
export const onSecureDnsChange = (listener: () => void) => on("engine.secureDns", listener);
