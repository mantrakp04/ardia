export const REPO_URL = "https://github.com/mantrakp04/ardia";

export const commitUrl = (sha: string) => `${REPO_URL}/commit/${sha}`;
export const releaseUrl = (tag: string) => `${REPO_URL}/releases/tag/${encodeURIComponent(tag)}`;
export const pullUrl = (number: string) => `${REPO_URL}/pull/${number}`;
export const issueUrl = (number: number) => `${REPO_URL}/issues/${number}`;

export const commitShas = (value: string | null) => (value ? value.match(/\b[0-9a-f]{7,40}\b/g) ?? [] : []);
export const pullNumbers = (value: string | null) => (value ? [...value.matchAll(/#(\d+)/g)].map((m) => m[1]!) : []);

export function xStatusId(url: string | null) {
  return url ? /(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/.exec(url)?.[1] ?? null : null;
}

export function xReplyIntent(targetUrl: string | null, intentUrl: string | null, text: string) {
  const id = xStatusId(targetUrl) ?? (intentUrl ? new URL(intentUrl).searchParams.get("in_reply_to") : null);
  if (!id) return null;
  return `https://twitter.com/intent/tweet?in_reply_to=${id}&text=${encodeURIComponent(text)}`;
}
