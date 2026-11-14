import { requireNativeModule } from "expo-modules-core";

export type SyncRuntimeCheck = { name: string; pass: boolean; actual: string; expected: string };

type SyncLabNative = { runtimeChecks?: () => Promise<SyncRuntimeCheck[]> };

export const syncLab = {
  runtimeChecks: (): Promise<SyncRuntimeCheck[]> => {
    const run = requireNativeModule<SyncLabNative>("ArdiaSync").runtimeChecks;
    return run ? run() : Promise.reject(new Error("the sync runtime checks run only in Android lab builds"));
  },
};
