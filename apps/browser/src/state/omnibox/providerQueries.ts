import type { ProviderSection } from "@ardia/core";
import type { OmniboxProvider } from "./providers";

export const PROVIDER_DEADLINE_MS = 1500;

export type ProviderQueries = {
  run(text: string, providers: readonly OmniboxProvider[], onSection: (section: ProviderSection) => void): void;
  cancel(): void;
};

function childOf(parent: AbortSignal, ms: number): { signal: AbortSignal; done(): void } {
  const child = new AbortController();
  const abort = () => child.abort();
  const timer = setTimeout(abort, ms);
  parent.addEventListener("abort", abort, { once: true });
  return {
    signal: child.signal,
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

export function createProviderQueries(deadlineMs: number = PROVIDER_DEADLINE_MS): ProviderQueries {
  let current: AbortController | null = null;
  const cancel = () => {
    current?.abort();
    current = null;
  };
  return {
    cancel,
    run(text, providers, onSection) {
      cancel();
      const run = new AbortController();
      current = run;
      for (const provider of providers) {
        const { signal, done } = childOf(run.signal, deadlineMs);
        const deadline = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true }));
        let answer: Promise<unknown>;
        try {
          answer = Promise.resolve(provider.query(text, signal));
        } catch {
          done();
          continue;
        }
        Promise.race([answer, deadline])
          .then((rows) => {
            if (!run.signal.aborted && !signal.aborted && Array.isArray(rows)) onSection({ id: provider.id, title: provider.title, rows });
          })
          .catch(() => {})
          .finally(done);
      }
    },
  };
}
