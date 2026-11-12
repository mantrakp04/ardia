export type DocumentWatchPort = {
  holds(): boolean;
  loading(): boolean;
  sameDocument(): Promise<boolean | null | undefined>;
  release(): void;
  wait(ms: number): Promise<void>;
};

const watching = new Map<string, number>();
let generations = 0;

export function stopDocumentWatch(tabId: string) {
  watching.delete(tabId);
}

export function watchedDocuments(): number {
  return watching.size;
}

export async function watchDocument(tabId: string, port: DocumentWatchPort, pollMs: number): Promise<void> {
  const generation = ++generations;
  watching.set(tabId, generation);
  const current = () => watching.get(tabId) === generation;
  try {
    while (current() && port.holds() && port.loading()) {
      const same = await port.sameDocument();
      if (!current()) return;
      if (same === false && port.holds()) return port.release();
      await port.wait(pollMs);
    }
  } finally {
    if (current()) watching.delete(tabId);
  }
}
