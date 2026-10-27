import { readDocument, writeDocument } from "../../platform/documents";

const REQUEST_LOG_DOC = "telemetry-requests.log";

export type RequestLogEntry = {
  at: string;
  kind: "events" | "logs" | "daily";
  url: string;
  count: number;
  bytes: number;
  status: number | null;
  dryRun?: boolean;
};

const requests: RequestLogEntry[] = [];

export const requestLog = (): readonly RequestLogEntry[] => requests;

export function logRequest(entry: RequestLogEntry, body: string) {
  requests.push(entry);
  if (requests.length > 200) requests.shift();
  if (__DEV__) {
    try {
      const line = JSON.stringify({ ...entry, body: JSON.parse(body) });
      writeDocument(REQUEST_LOG_DOC, (readDocument(REQUEST_LOG_DOC) ?? "").slice(-400_000) + `${line}\n`);
    } catch {}
  }
  if (__DEV__) console.log(`[telemetry] ${entry.dryRun ? "dry run" : "POST"} ${entry.url} ${entry.kind}×${entry.count} → ${entry.status}`);
}
