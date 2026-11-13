type TelemetrySettle = { settle(endsSession: boolean): Promise<string | null>; reopen(token: string): Promise<void> };

let current: TelemetrySettle = { settle: async () => null, reopen: async () => {} };

export const setTelemetrySettle = (next: TelemetrySettle) => void (current = next);
export const settleTelemetry = (endsSession: boolean) => current.settle(endsSession);
export const reopenTelemetry = (token: string) => current.reopen(token);

export function createEndLedger(newToken: () => string = () => crypto.randomUUID()) {
  let last: string | null = null;
  return {
    end: () => (last = newToken()),
    reopens: (token: string | undefined) => {
      if (!token || token !== last) return false;
      last = null;
      return true;
    },
  };
}
