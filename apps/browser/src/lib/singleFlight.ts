export type Flight = { readonly again: boolean; repeat(): void };

export function singleFlight(pass: (flight: Flight) => Promise<void>, keepGoing: () => boolean = () => true): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const flight: Flight = {
    get again() {
      return again;
    },
    repeat: () => void (again = true),
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass(flight);
        } while (again && keepGoing());
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
