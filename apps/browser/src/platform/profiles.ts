import { call, type BrowsingDataType } from "@ardia/ardiacore";

export type { BrowsingDataType };

export const clearBrowsingData = (profile: string, types: BrowsingDataType[], since?: number) =>
  call("profiles.clearBrowsingData", { profile, types, since: since ?? null }).then(() => {});
export const releaseProfile = (profile: string) => call("profiles.release", { profile });
export const deleteProfileData = async (profile: string): Promise<string[]> => (await call("profiles.deleteData", { profile })).remaining;
