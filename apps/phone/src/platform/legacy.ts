import { legacy as native } from "@ardia/phone-native";
export type { LegacyData } from "@ardia/phone-native";

type MaybeMarks = { markImported?: () => Promise<void> };

export const legacy = {
  available: () => native.available(),
  read: () => native.read(),
  markImported: async () => {
    const mark = (native as MaybeMarks).markImported;
    if (mark) await mark();
  },
};
