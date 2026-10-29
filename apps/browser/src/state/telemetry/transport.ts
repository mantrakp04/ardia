import { systemInfo, type SystemInfo } from "../../platform/app";
import { devTestValue } from "../../platform/launchConfig";
import { DEV_SEND_TEST_KEY, LOGS_URL } from "./config";
import { logRequest, type RequestLogEntry } from "./requestLog";

let app: SystemInfo | null = null;
export const appInfo = () => (app ??= systemInfo());

const devSendAllowed = () => devTestValue(DEV_SEND_TEST_KEY) === "1";

export const mayPost = (kind: RequestLogEntry["kind"]) =>
  kind === "daily" ? devSendAllowed() || (!__DEV__ && appInfo().isolatedInstance === false) : !__DEV__ || devSendAllowed();

export async function post(kind: RequestLogEntry["kind"], body: string, count: number, signal?: AbortSignal): Promise<number> {
  const entry: RequestLogEntry = { at: new Date().toISOString(), kind, url: LOGS_URL, count, bytes: body.length, status: null };
  if (!mayPost(kind)) {
    logRequest({ ...entry, dryRun: true }, body);
    return 200;
  }
  try {
    const response = await fetch(LOGS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
    entry.status = response.status;
  } catch {
    entry.status = 0;
  }
  logRequest(entry, body);
  return entry.status;
}

export const percentile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
