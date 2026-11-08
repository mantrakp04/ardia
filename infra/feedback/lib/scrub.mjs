const URL_PATTERN = /\b(?:https?|wss?|ftp|file):\/\/[^\s<>"'`]+/gi;
const EMAIL_PATTERN = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g;
const HOME_PATTERN = /(\/(?:Users|home)\/)(?!\[user\])[^/\s"'`<>]+/g;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bFB-[2-9A-HJ-NP-Z]{4,5}\.[0-9]{1,12}\.[A-Za-z0-9_-]{43}/g,
];
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic|Token)([ \t]+)[A-Za-z0-9._~+/-]{16,}=*/g;

function trimUrl(url) {
  let trail = "";
  while (/[.,;:!?)\]}]$/.test(url)) {
    trail = url.slice(-1) + trail;
    url = url.slice(0, -1);
  }
  const cut = url.search(/[?#]/);
  const bare = cut === -1 ? url : url.slice(0, cut);
  return bare.replace(/^([a-z]+:\/\/)[^/@\s]*@/i, "$1") + trail;
}

export function scrubText(text) {
  let out = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[secret]");
  out = out.replace(AUTH_HEADER_PATTERN, "$1$2[secret]");
  out = out.replace(URL_PATTERN, trimUrl);
  out = out.replace(EMAIL_PATTERN, "[email]");
  out = out.replace(HOME_PATTERN, "$1[user]");
  return out;
}

export function quietMentions(text) {
  return String(text ?? "").replace(/(^|[^A-Za-z0-9_`])@(?=[A-Za-z0-9])/g, "$1@\u200b");
}

export function scrubForIssue(text) {
  return quietMentions(scrubText(text));
}
