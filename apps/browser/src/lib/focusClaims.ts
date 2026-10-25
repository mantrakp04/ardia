type Running = { generation: number; windowId: string; source: string | undefined; expects: boolean };
type Awaiting = { generation: number; source: string | undefined; destinations: Set<string>; claimed: boolean };

let running: Running | null = null;
let sendClaim: ((generation: number, tag: number) => void) | null = null;
let sendCancel: ((generation: number, restoringSource: boolean) => void) | null = null;
const awaiting = new Map<string, Awaiting>();
const CLAIM_TRIES = 20;
const CLAIM_RETRY_MS = 50;

export function setFocusSenders(
  claim: (generation: number, tag: number) => void,
  cancel: (generation: number, restoringSource: boolean) => void,
) {
  sendClaim = claim;
  sendCancel = cancel;
}

export function runFocusMove(generation: number, windowId: string, source: string | undefined, run: () => void): boolean {
  const outer = running;
  const mine: Running = { generation, windowId, source, expects: false };
  running = mine;
  try {
    run();
  } finally {
    running = outer;
  }
  return mine.expects;
}

export function expectFocus(windowId: string, destination: string) {
  if (running?.windowId !== windowId) return;
  running.expects = true;
  const current = awaiting.get(windowId);
  if (current?.generation === running.generation) current.destinations.add(destination);
  else awaiting.set(windowId, { generation: running.generation, source: running.source, destinations: new Set([destination]), claimed: false });
}

export function claimFocusTag(windowId: string, destination: string, tagOf: () => number | null) {
  const request = awaiting.get(windowId);
  if (!request?.destinations.has(destination) || request.claimed) return;
  const attempt = (tries: number) => {
    if (awaiting.get(windowId) !== request || request.claimed) return;
    const tag = tagOf();
    if (!tag) {
      if (tries > 1) setTimeout(() => attempt(tries - 1), CLAIM_RETRY_MS);
      return;
    }
    request.claimed = true;
    request.destinations = new Set([destination]);
    sendClaim?.(request.generation, tag);
  };
  setTimeout(() => attempt(CLAIM_TRIES), 0);
}

export function cancelAbandonedFocus(
  stillPossible: (windowId: string, destination: string) => boolean,
  shownTab: (windowId: string) => string | undefined,
) {
  for (const [windowId, request] of awaiting) {
    if (running?.windowId === windowId || [...request.destinations].some((d) => stillPossible(windowId, d))) continue;
    awaiting.delete(windowId);
    sendCancel?.(request.generation, request.source !== undefined && shownTab(windowId) === request.source);
  }
}

export const commandBarFocus = "commandBar";
export const heroBarFocus = (tabId: string) => `heroBar:${tabId}`;
export const findFocus = (tabId: string) => `find:${tabId}`;
export const urlEditFocus = (tabId: string) => `urlEdit:${tabId}`;
export const pageFocus = (tabId: string) => `page:${tabId}`;
