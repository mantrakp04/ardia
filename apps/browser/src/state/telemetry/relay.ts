export type CaptureOptions = {
  raw?: Record<string, unknown>;
  urgent?: boolean;
  persist?: boolean;
};

export type TelemetryRelay = {
  capture(event: string, props: Record<string, unknown>, options: CaptureOptions): void;
  log(level: "warn" | "error", message: string, attributes: Record<string, string | number | boolean>): void;
  resetId(): Promise<string>;
};

let relay: TelemetryRelay | null = null;

export const telemetryRelay = () => relay;
export const setTelemetryRelay = (next: TelemetryRelay | null) => void (relay = next);
