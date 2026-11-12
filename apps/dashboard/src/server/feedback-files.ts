import type { serverEnv } from "./env";

type Read = typeof serverEnv;

const FEEDBACK_BUCKET = "/buckets/feedback/";
const REPLAYS_BUCKET = /\/buckets\/replays\/?$/;

export function feedbackFileBases(read: Read): string[] {
  const explicit = read("FEEDBACK_FILES_URL");
  const reportHost = read("FEEDBACK_OBJECTS_HOST");
  const current = explicit ? (explicit.endsWith("/") ? explicit : `${explicit}/`) : reportHost ? `http://${reportHost}:8888${FEEDBACK_BUCKET}` : null;
  const replays = read("REPLAYS_URL");
  const replayHost = read("REPLAYS_HOST");
  const beforeTheMove = replays && REPLAYS_BUCKET.test(replays) ? replays.replace(REPLAYS_BUCKET, FEEDBACK_BUCKET) : replayHost ? `http://${replayHost}:8888${FEEDBACK_BUCKET}` : null;
  return [...new Set([current, beforeTheMove].filter((base): base is string => base !== null))];
}

type FileRequest = { headers: Record<string, string>; range: string | null; signal: AbortSignal };

export async function fetchFeedbackFile(bases: string[], id: string, name: string, { headers, range, signal }: FileRequest, send: typeof fetch = fetch): Promise<Response | undefined> {
  let found: Response | undefined;
  for (const base of bases) {
    found = await send(`${base}${encodeURIComponent(id)}/${encodeURIComponent(name)}`, { headers: { ...headers, ...(range ? { Range: range } : {}) }, signal });
    if (found.status !== 404) break;
  }
  return found;
}
