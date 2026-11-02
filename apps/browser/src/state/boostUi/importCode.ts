import { importBoost } from "../boosts/actions";
import { decodeBoost } from "../boosts/share";
import type { Boost } from "../boosts/types";

export const previewImport = (code: string): Boost | { error: string } | null => (code.trim() ? decodeBoost(code) : null);

export const installBoost = (profileId: string, boost: Boost) => importBoost(profileId, null, boost);
