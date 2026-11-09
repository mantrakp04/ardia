import type { HLC } from "./hlc.ts";

export type Origin = [device: string, seq: number];
export type SyncRecord = { h: HLC; v: unknown; o: Origin };
export type Op = { k: string; h: HLC; v: unknown };

export type LogFile = { v: 1; kind: "log"; device: string; seq: number; at: number; ops: Op[] };
export type SnapshotFile = {
  v: 1;
  kind: "snapshot";
  device: string;
  at: number;
  vv: Record<string, number>;
  seen: Record<string, number>;
  records: Record<string, SyncRecord>;
};
export type SyncFile = LogFile | SnapshotFile;

type FileMeta = { d: string; k: "log" | "snapshot" | "bad"; s?: number; vv?: Record<string, number>; at: number };

export type ScopeState = {
  records: Record<string, SyncRecord>;
  base: Record<string, string>;
  unapplied: string[];
  vv: Record<string, number>;
  extra: Record<string, number[]>;
  files: Record<string, FileMeta>;
  damaged: Record<string, number>;
  pendingSince?: Record<string, number>;
  seq: number;
  outbox: Op[];
  journal?: LogFile[];
  seen: Record<string, number>;
  joined: boolean;
  awaitRemote?: boolean;
  applyAs?: Record<string, "joined" | "joining">;
  snapshotAt: number;
  pending: number;
};

export const emptyScope = (): ScopeState => ({
  records: {},
  base: {},
  unapplied: [],
  vv: {},
  extra: {},
  files: {},
  damaged: {},
  seq: 0,
  outbox: [],
  seen: {},
  joined: false,
  snapshotAt: 0,
  pending: 0,
});

export interface Transport {
  write(scope: string, payload: string): Promise<string>;
  read(scope: string, known: string[]): Promise<Listing>;
  remove(scope: string, ids: string[]): Promise<void>;
}

export type Listing = {
  files: { id: string; payload: string }[];
  pending: string[];
  damaged: { id: string; age: number }[];
  present: string[];
};

export type Extraction = {
  values: Map<string, unknown>;
  ignore?: (key: string) => boolean;
  republish?: (key: string) => boolean;
  published?: (keys: Set<string>) => void;
};

export type ApplyRecords = {
  known(key: string): boolean;
  now: number;
  horizon: number;
  joined: boolean;
  held(): boolean;
  landed(key: string): void;
};

export interface Adapter {
  prefix: string;
  extract(
    base: (key: string) => unknown,
    queued: (key: string) => boolean,
    now: number,
    known: (key: string) => boolean,
    remote: (key: string) => unknown,
    stamp: (key: string) => HLC | undefined,
  ): Extraction | null | Promise<Extraction | null>;
  apply(visible: Map<string, unknown>, changed: Set<string>, base: (key: string) => unknown, records: ApplyRecords): boolean | void | Promise<boolean | void>;
  editedAt?(value: unknown): number | undefined;
  adoptRemoteOnJoin?: boolean;
  publishAfterPull?: boolean;
}

export type ScopeOptions = {
  expired?: (key: string, value: unknown, now: number) => boolean;
  tombstoneTTL?: number;
  compactAfterFiles?: number;
  compactInterval?: number;
  pruneGrace?: number;
  damagedGiveUp?: number;
  persist?: (batches: LogFile[]) => Promise<void>;
  holdApply?: () => boolean;
};
