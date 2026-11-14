import { requireNativeModule } from "expo-modules-core";

export type SyncRuntimeCheck = { name: string; pass: boolean; actual: string; expected: string };

type SyncLabNative = { runtimeChecks?: () => Promise<SyncRuntimeCheck[]>; damageInbox?: () => Promise<{ inboxProblem: string | null }> };

export const syncLab = {
  runtimeChecks: (): Promise<SyncRuntimeCheck[]> => {
    const run = requireNativeModule<SyncLabNative>("ArdiaPhoneSync").runtimeChecks;
    return run ? run() : Promise.reject(new Error("the sync runtime checks run only in Android lab builds"));
  },
  damageInbox: (): Promise<{ inboxProblem: string | null }> => {
    const damage = requireNativeModule<SyncLabNative>("ArdiaPhoneSync").damageInbox;
    return damage ? damage() : Promise.reject(new Error("the inbox can be damaged only in Android lab builds"));
  },
};
