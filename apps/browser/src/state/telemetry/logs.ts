import { queueLog } from "./client";
import { errorCode, errorMessage, errorType, scrubText } from "./sanitize";

const MAX_DISTINCT = 40;
const seen = new Set<string>();

export function recordLog(level: "warn" | "error", args: unknown[]) {
  const first = args[0];
  if (typeof first !== "string") return;
  const message = scrubText(first, 160);
  if (!message || seen.has(message) || seen.size >= MAX_DISTINCT) return;
  seen.add(message);
  const error = args.slice(1).find((a) => a instanceof Error);
  const attributes: Record<string, string> = { error_type: error ? errorType(error) : "none" };
  if (error) {
    const reason = errorMessage(error);
    if (reason) attributes.error_message = reason;
    const code = errorCode(error);
    if (code) attributes.error_code = code;
  }
  queueLog(level, message, attributes);
}
