export type Passage = [number, [number, string][]];
export type Translated = [number, string | null];
export type PageBatch = { passages: unknown[]; more: boolean; gone: boolean; done: number; total: number };

export type DrainPort = {
  inFlight: number;
  holds(): boolean;
  released: Promise<void>;
  next(max: number): Promise<PageBatch | null | undefined>;
  translate(passage: Passage): Promise<Translated[]>;
  apply(results: Translated[]): Promise<unknown>;
  onStage?(stage: "collect" | "model" | "apply"): void;
  onApplied?(total: number): void;
};

const MAX_PIECES = 40;

export const cleanPassages = (passages: unknown[]): Passage[] =>
  passages
    .filter((p): p is Passage => Array.isArray(p) && typeof p[0] === "number" && Array.isArray(p[1]))
    .map(([id, pieces]): Passage => [id, pieces.filter((x) => Array.isArray(x) && typeof x[0] === "number" && typeof x[1] === "string").slice(0, MAX_PIECES)]);

const untranslated = ([, pieces]: Passage): Translated[] => pieces.map(([id]): Translated => [id, null]);

export async function drainPassages(port: DrainPort): Promise<boolean> {
  const running = new Set<Promise<void>>();
  const backlog: Passage[] = [];
  let failure: { error: unknown } | null = null;
  let total = 0;
  let exhausted = false;
  let released = false;
  void port.released.then(() => (released = true));
  const live = () => !released && port.holds();
  const settle = async () => {
    await Promise.race([Promise.allSettled(running), port.released]);
    if (!live()) return false;
    if (failure) throw failure.error;
    return true;
  };
  const start = (passage: Passage) => {
    const job = port
      .translate(passage)
      .then(
        async (results) => {
          if (!live()) return;
          port.onStage?.("apply");
          await port.apply(results);
          if (live()) port.onApplied?.(total);
        },
        async (error: unknown) => {
          if (!live()) return;
          failure ??= { error };
          await port.apply(untranslated(passage)).catch(() => {});
        },
      )
      .catch((error: unknown) => {
        if (live()) failure ??= { error };
      })
      .finally(() => running.delete(job));
    running.add(job);
  };
  for (;;) {
    if (!live()) return false;
    if (failure) return settle();
    while (running.size < port.inFlight && backlog.length) start(backlog.shift()!);
    if (running.size < port.inFlight && !exhausted) {
      port.onStage?.("collect");
      const batch = await port.next(port.inFlight - running.size);
      if (!live()) return false;
      if (!batch || batch.gone || !Array.isArray(batch.passages)) return false;
      total = batch.total;
      exhausted = !batch.more;
      backlog.push(...cleanPassages(batch.passages));
      if (backlog.length) {
        port.onStage?.("model");
        continue;
      }
    }
    if (!running.size && !backlog.length) return settle();
    await Promise.race([...running, port.released]);
    exhausted = false;
  }
}
