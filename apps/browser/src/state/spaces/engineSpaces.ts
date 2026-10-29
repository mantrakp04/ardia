import type { BrowserState } from "../browser/store";
import { engineProfileIn } from "../browser/model";

export { engineProfiles as engineSpaces } from "../profiles/engineProfiles";

export const spacesUsing = (s: Pick<BrowserState, "spaces" | "profiles">, engine: string) =>
  Object.keys(s.spaces).filter((id) => engineProfileIn(s, id) === engine);
