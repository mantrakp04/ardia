import type { ArdiaHost } from "./host";
import type { LiveProjection } from "../../browser/src/platform/livePersistence";

const documents = new WeakMap<ArdiaHost, string>();
export const readCanonicalLiveDocument = (host: ArdiaHost) => documents.get(host) ?? null;
export const acceptCanonicalLiveDocument = (host: ArdiaHost, payload: LiveProjection) => { documents.set(host, JSON.stringify({ ...payload, version: 1 })); };
