import type { Adapter, Extraction } from "./scopeState.ts";

export type LocalExtension = {
  id: string;
  syncable: boolean;
  version?: string;
  approved?: boolean;
  fingerprint?: string;
  userDisabled?: boolean;
  incognito?: boolean;
  pinned?: boolean;
};

export type LocalExtensions = { ready: boolean; extensions: LocalExtension[]; pending: string[]; settling?: string[]; queued?: string[] };

export type ExtensionState = { on: boolean; inc: boolean; pin: boolean };
export type ExtensionRemoval = { removed: true };
export type ExtensionApproval = { v: string; fps: string[] };

export type ExtensionIntent = { kind: "installed" | "uninstalled"; g: number };

export type ExtensionChange =
  | { kind: "install"; id: string; record: ExtensionState; approval: ExtensionApproval | null }
  | { kind: "reconcile"; id: string; record: ExtensionState; approval: ExtensionApproval | null }
  | { kind: "cancel"; id: string };

export interface ExtensionsHost {
  read(): Promise<LocalExtensions | null>;
  change(change: ExtensionChange): Promise<boolean>;
  intents(): Record<string, ExtensionIntent>;
  settleIntents(published: Record<string, number>): void;
  keepInstalled(id: string): void;
}

export type ExtensionsAdapter = Adapter & {
  reconcile(visible: Map<string, unknown>, now: number, held?: () => boolean): Promise<void>;
};

export const EXTENSION_PREFIX = "ext:";
export const EXTENSION_APPROVAL_PREFIX = "ext:v:";
export const EXTENSION_RETRY_MS = 3_600_000;

export const extensionKey = (id: string) => `${EXTENSION_PREFIX}${id}`;
export const extensionApprovalKey = (id: string) => `${EXTENSION_APPROVAL_PREFIX}${id}`;
export const extensionIdOf = (key: string) =>
  key.startsWith(EXTENSION_APPROVAL_PREFIX) ? key.slice(EXTENSION_APPROVAL_PREFIX.length) : key.slice(EXTENSION_PREFIX.length);
const isStateKey = (key: string) => key.startsWith(EXTENSION_PREFIX) && !key.startsWith(EXTENSION_APPROVAL_PREFIX);

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export const isRemoval = (v: unknown): v is ExtensionRemoval => !!v && typeof v === "object" && (v as ExtensionRemoval).removed === true;

export const isExtensionState = (v: unknown): v is ExtensionState =>
  !!v &&
  typeof v === "object" &&
  !isRemoval(v) &&
  typeof (v as ExtensionState).on === "boolean" &&
  typeof (v as ExtensionState).inc === "boolean" &&
  typeof (v as ExtensionState).pin === "boolean";

const MAX_FINGERPRINTS = 8;

const isApproval = (v: unknown): v is ExtensionApproval =>
  !!v &&
  typeof v === "object" &&
  typeof (v as ExtensionApproval).v === "string" &&
  Array.isArray((v as ExtensionApproval).fps) &&
  (v as ExtensionApproval).fps.every((fp) => typeof fp === "string");

const localState = (e: LocalExtension): ExtensionState => ({ on: !e.userDisabled, inc: !!e.incognito, pin: !!e.pinned });

const sameState = (a: ExtensionState, b: ExtensionState) => a.on === b.on && a.inc === b.inc && a.pin === b.pin;

const grantable = (approval: ExtensionApproval | null, e: LocalExtension) =>
  !!approval && !e.approved && approval.v === e.version && e.fingerprint !== undefined && approval.fps.includes(e.fingerprint);

function approvalToPublish(e: LocalExtension, known: ExtensionApproval | null): ExtensionApproval | null {
  if (!e.approved || e.fingerprint === undefined || !e.version) return known;
  if (!known || compareVersions(e.version, known.v) > 0) return { v: e.version, fps: [e.fingerprint] };
  if (compareVersions(e.version, known.v) < 0 || known.fps.includes(e.fingerprint)) return known;
  return { v: known.v, fps: [...known.fps, e.fingerprint].sort().slice(-MAX_FINGERPRINTS) };
}

const newerApproval = (approval: ExtensionApproval | null, e: LocalExtension) => !!approval && compareVersions(approval.v, e.version ?? "0") > 0;

export function extensionsAdapter(host: ExtensionsHost): ExtensionsAdapter {
  const tried = new Map<string, number>();
  const unsettled = new Set<string>();
  const run = async (change: ExtensionChange) => {
    const ok = await host.change(change);
    if (ok) unsettled.delete(change.id);
    else unsettled.add(change.id);
    return ok;
  };

  const reconcileOne = async (
    id: string,
    record: unknown,
    approvalValue: unknown,
    local: LocalExtensions,
    intents: Record<string, ExtensionIntent>,
    joined: boolean,
    held: () => boolean,
  ) => {
    if (held()) return false;
    const e = local.extensions.find((x) => x.id === id);
    const pending = local.pending.includes(id);
    const queued = !!local.queued?.includes(id);
    const approval = isApproval(approvalValue) ? approvalValue : null;
    if (isRemoval(record)) {
      if (intents[id]?.kind === "installed") return true;
      if (!joined && e?.syncable) {
        host.keepInstalled(id);
        return true;
      }
      return !e && (pending || queued) ? run({ kind: "cancel", id }) : true;
    }
    if (!isExtensionState(record)) return true;
    if (e) {
      if (!e.syncable) return true;
      if (!sameState(record, localState(e)) || grantable(approval, e) || newerApproval(approval, e)) return run({ kind: "reconcile", id, record, approval });
      return true;
    }
    if (intents[id]?.kind === "uninstalled") return true;
    return run({ kind: "install", id, record, approval });
  };

  return {
    prefix: EXTENSION_PREFIX,
    adoptRemoteOnJoin: true,
    extract: async (base, queued, _now, known) => {
      const local = await host.read();
      if (!local?.ready) return null;
      const intents = host.intents();
      const values = new Map<string, unknown>();
      const captured: Record<string, number> = {};
      const installed = new Set<string>();
      const settling = new Set([...local.pending, ...(local.settling ?? []), ...unsettled]);
      for (const e of local.extensions) {
        if (!e.syncable || !e.version) continue;
        installed.add(e.id);
        if (settling.has(e.id)) continue;
        const key = extensionKey(e.id);
        const stored = base(key);
        const explicit = intents[e.id]?.kind === "installed";
        if (!explicit && ((known(key) && stored === undefined) || isRemoval(stored))) continue;
        values.set(key, localState(e));
        if (explicit) captured[e.id] = intents[e.id]!.g;
        const storedApproval = base(extensionApprovalKey(e.id));
        const approval = approvalToPublish(e, isApproval(storedApproval) ? storedApproval : null);
        if (approval) values.set(extensionApprovalKey(e.id), approval);
      }
      for (const [id, intent] of Object.entries(intents)) {
        if (intent.kind !== "uninstalled" || installed.has(id)) continue;
        values.set(extensionKey(id), { removed: true } satisfies ExtensionRemoval);
        captured[id] = intent.g;
      }
      return {
        values,
        ignore: (key) => !values.has(key),
        republish: (key) => isStateKey(key) && extensionIdOf(key) in captured && !queued(key),
        published: (keys) => {
          const settled = Object.fromEntries([...keys].filter(isStateKey).map(extensionIdOf).filter((id) => id in captured).map((id) => [id, captured[id]!]));
          if (Object.keys(settled).length) host.settleIntents(settled);
        },
      } satisfies Extraction;
    },
    apply: async (visible, changed, _base, records) => {
      const local = await host.read();
      if (!local?.ready) return false;
      const intents = host.intents();
      let ok = true;
      for (const id of new Set([...changed].map(extensionIdOf))) {
        ok = (await reconcileOne(id, visible.get(extensionKey(id)), visible.get(extensionApprovalKey(id)), local, intents, records.joined, records.held)) && ok;
      }
      return ok && !records.held();
    },
    reconcile: async (visible, now, held = () => false) => {
      const local = await host.read();
      if (!local?.ready) return;
      const intents = host.intents();
      for (const [key, record] of visible) {
        if (!isStateKey(key) || !isExtensionState(record)) continue;
        const id = extensionIdOf(key);
        const e = local.extensions.find((x) => x.id === id);
        const approval = visible.get(extensionApprovalKey(id));
        if (e) {
          if (e.syncable && grantable(isApproval(approval) ? approval : null, e)) await reconcileOne(id, record, approval, local, intents, true, held);
          continue;
        }
        if (held()) return;
        if (local.pending.includes(id) || now - (tried.get(id) ?? -Infinity) < EXTENSION_RETRY_MS) continue;
        tried.set(id, now);
        await reconcileOne(id, record, approval, local, intents, true, held);
      }
    },
  };
}
