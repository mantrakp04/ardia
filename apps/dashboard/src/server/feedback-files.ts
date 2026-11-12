type Read = (name: string) => string | undefined;

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
