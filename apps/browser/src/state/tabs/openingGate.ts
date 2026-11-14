export type OpeningVia = "typed" | "newTab" | "link" | "external";
export type OpeningContext = { tabId: string | null; windowId: string | null; profileId: string | null; via: OpeningVia };
export type OpeningVerdict = { url: string } | { cancel: true } | null;
export type OpeningGate = (url: string, context: OpeningContext, signal: AbortSignal) => OpeningVerdict | Promise<OpeningVerdict>;

let gate: OpeningGate | null = null;
const holds = new Map<string, AbortController>();

export const setOpeningGate = (next: OpeningGate | null) => {
  gate = next;
};

export const isGatedUrl = (url: string) => /^https?:\/\//i.test(url);

export function supersedeOpening(key: string): AbortSignal {
  holds.get(key)?.abort();
  const controller = new AbortController();
  holds.set(key, controller);
  return controller.signal;
}

export function cancelOpening(key: string) {
  const held = holds.get(key);
  if (!held) return;
  holds.delete(key);
  held.abort();
}

export function releaseOpening(key: string, signal: AbortSignal) {
  const held = holds.get(key);
  if (held?.signal === signal) holds.delete(key);
}

export function gateOpening(url: string, context: OpeningContext, key: string | null): { verdict: OpeningVerdict } | { pending: Promise<OpeningVerdict>; signal: AbortSignal } {
  if (!gate || !isGatedUrl(url)) {
    if (key) cancelOpening(key);
    return { verdict: null };
  }
  const signal = key ? supersedeOpening(key) : new AbortController().signal;
  let result: OpeningVerdict | Promise<OpeningVerdict>;
  try {
    result = gate(url, context, signal);
  } catch (error) {
    console.warn("[automation] tab.opening failed; opening as asked", error);
    result = null;
  }
  if (!(result instanceof Promise)) {
    if (key) releaseOpening(key, signal);
    return { verdict: result };
  }
  const pending = result.then(
    (verdict) => (signal.aborted ? null : verdict),
    () => null,
  );
  return { pending, signal };
}

export function settleOpening<T>(gated: ReturnType<typeof gateOpening>, key: string | null, apply: (verdict: OpeningVerdict) => T): T | undefined {
  if ("verdict" in gated) return apply(gated.verdict);
  void gated.pending.then((verdict) => {
    if (gated.signal.aborted) return;
    if (key) releaseOpening(key, gated.signal);
    apply(verdict);
  });
  return undefined;
}
