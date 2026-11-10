import { loadChoice, save, savedChoice, sessionId } from "./choice";
import { capture } from "./client";
import { uuidv4 } from "./ids";

export function enforceSharing() {
  loadChoice();
  const current = savedChoice();
  if (current.sharing) {
    if (current.sharingUntil !== null) save({ sharingUntil: null });
    return;
  }
  const now = Date.now();
  save({ sharing: true, installId: current.installId ?? uuidv4(), crashCursor: now, decidedAt: now, askDoneAt: current.askDoneAt ?? now });
  capture("sharing_turned_on", { source: "required" });
}

export const reopenSession = () => save({ sessionOpen: true, sessionId: sessionId() });
