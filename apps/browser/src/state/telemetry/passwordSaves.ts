import { orWarn, passwordFailure } from "../../lib/fallback";
import { capture } from "./client";

export type PasswordImportSource = "browser" | "csv";

export function passwordImportTally(source: PasswordImportSource) {
  const counts = { tried: 0, saved: 0, refused: 0, not_landed: 0, other: 0 };
  const warn = orWarn(false, source === "csv" ? "csv import" : "browser import");
  return {
    async attempt(save: Promise<boolean>): Promise<boolean> {
      counts.tried++;
      try {
        const saved = await save;
        if (saved) counts.saved++;
        else counts.other++;
        return saved;
      } catch (error) {
        const failure = passwordFailure(error);
        if (failure === "refused-or-already-saved") counts.refused++;
        else if (failure === "not-landed-in-time") counts.not_landed++;
        else counts.other++;
        return warn(error);
      }
    },
    done() {
      if (counts.tried) capture("password_import", { source, ...counts });
    },
  };
}
