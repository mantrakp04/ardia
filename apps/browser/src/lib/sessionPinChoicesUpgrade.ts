import { Clock } from "@ardia/sync";
import { isFields, isString } from "./decode";
import type { SavedObject } from "./savedDocument";

const choiceStamp = (choice: unknown) => (typeof choice === "number" ? new Clock("", null, () => choice).tick() : choice);

export const sessionWithPinChoiceStamps = (doc: SavedObject): SavedObject => {
  if (!isFields(doc.pinChoices)) return doc;
  const byProfile = Object.entries(doc.pinChoices).map(([profileId, mine]) => [
    profileId,
    isFields(mine) ? Object.fromEntries(Object.entries(mine).map(([key, choice]) => [key, choiceStamp(choice)]).filter(([, choice]) => isString(choice))) : {},
  ]);
  return { ...doc, pinChoices: Object.fromEntries(byProfile) };
};
