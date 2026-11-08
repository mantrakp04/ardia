const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s<>"'`]+/gi;
const EMAIL_PATTERN = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g;
const HOME_PATTERN = /(\/(?:Users|home)\/)(?!\[user\])[^/\s"'`<>]+/g;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
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
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic|Token)([ \t]+)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-]|[A-Za-z]{20})[A-Za-z0-9._~+/=-]+/gi;
const BT = "`";
const QUOTED = String.raw`"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|${BT}[^${BT}\r\n]*${BT}`;
const DIGEST_PATTERN = new RegExp(String.raw`\bdigest(\s+)(?:[a-z][a-z0-9-]*\s*=\s*(?:${QUOTED}|[^,\s]+)(?:\s*,\s*)?)+`, "gi");
const HEADER_PATTERN = new RegExp(String.raw`(?<![A-Za-z0-9-])((?:proxy-)?authorization|(?:set-)?cookie|x-[a-z0-9-]*(?:token|key|secret|auth|session|password)[a-z0-9-]*|api-key|private-token)(["'${BT}]?[ \t]*:[ \t]*)(?![ \t]*(?:Digest\s+)?\[secret\])((?:[^\r\n'"${BT}\\]|\\.|"(?:[^"\\\r\n]|\\.)*")+)`, "gi");
const SECRET_KEY = "[A-Za-z0-9_.-]*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?|session[_-]?(?:id|key|token|secret)|sessionid|auth[_-]?(?:token|key|code)|cookie|signature|otp)[A-Za-z0-9_-]*";
const KEY_VALUE_PATTERN = new RegExp(String.raw`(?<![A-Za-z0-9_.-])(["'${BT}]?${SECRET_KEY}["'${BT}]?\]?)([ \t]*(?:=>|:=|=|:)[ \t]*)(?!\[secret\])(${QUOTED}|[^\s,;&'"${BT}<>(){}\[\]]+)`, "gi");
const SECRET_FLAG_PATTERN = new RegExp(String.raw`(?<![A-Za-z0-9_-])(--?${SECRET_KEY})([ \t]+|=)(?!\[secret\])(${QUOTED}|[^\s'"${BT}]+)`, "gi");
const COOKIE_PAIR_PATTERN = new RegExp(String.raw`(?<![A-Za-z0-9_.-])(session|sess|sid|connect\.sid|phpsessid|jsessionid|asp\.net_sessionid|csrftoken|xsrf-token|_[a-z0-9_]*session[a-z0-9_]*)(=)(?!\[secret\])(${QUOTED}|[^\s;,&'"${BT}]+)`, "gi");
const USER_FLAG_PATTERN = new RegExp(String.raw`(?<!\S)(-u|--user|--proxy-user)([ \t]+|=)(${QUOTED}|[^\s'"${BT}]+)`, "g");

function trimUrl(url) {
  let trail = "";
  while (/[.,;:!?)\]}]$/.test(url)) {
    trail = url.slice(-1) + trail;
    url = url.slice(0, -1);
  }
  const cut = url.search(/[?#]/);
  const bare = cut === -1 ? url : url.slice(0, cut);
  return bare.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1") + trail;
}

const CREDENTIAL_START = new RegExp(
  String.raw`(?:(?<![A-Za-z0-9_.-])(?:${SECRET_KEY}|(?:proxy-)?authorization|(?:set-)?cookie|x-[a-z0-9-]*(?:token|key|secret|auth|session|password)[a-z0-9-]*|api-key|private-token)(?:\\?["'${BT}])?\]?[ \t]*(?:=>|:=|=|:)|(?<!\S)--?${SECRET_KEY}(?:[ \t]+|=)|(?<!\S)(?:-u|--user|--proxy-user)(?:[ \t]+|=)|(?<!\S)-u(?=[^\s:]*:))[ \t]*`,
  "i",
);
const TRIPLE_QUOTES = ['"""', "'''"];

function openQuote(text, open = null) {
  for (let i = 0; i < text.length; i++) {
    if (open && open.length === 3) {
      if (text.startsWith(open, i)) {
        open = null;
        i += 2;
      }
      continue;
    }
    const c = text[i];
    const triple = open ? null : TRIPLE_QUOTES.find((q) => text.startsWith(q, i));
    const apostrophe = c === "'" && /\p{L}/u.test(text[i - 1] ?? "") && /\p{L}/u.test(text[i + 1] ?? "");
    if (c === "\\") i++;
    else if (apostrophe) continue;
    else if (open) open = c === open ? null : open;
    else if (triple) {
      open = triple;
      i += 2;
    } else if (c === '"' || c === "'" || c === BT) open = c;
  }
  return open;
}

function redactCredentialLines(text) {
  let quote = null;
  let continued = false;
  let folding = false;
  let listValue = false;
  const kept = [];
  for (const line of text.split("\n")) {
    if (quote) {
      quote = openQuote(line, quote);
      continue;
    }
    if (continued) {
      quote = openQuote(line);
      continued = /\\[ \t]*$/.test(line);
      continue;
    }
    if (folding && listValue && /^[ \t]*(?:#.*)?$/.test(line)) {
      if (!line.trim()) kept.push(line);
      continue;
    }
    if (folding && (/^[ \t]/.test(line) || (listValue && /^-(?:[ \t]|$)/.test(line)))) continue;
    folding = false;
    const match = CREDENTIAL_START.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }
    const cut = match.index + match[0].length;
    quote = openQuote(line);
    continued = /\\[ \t]*$/.test(line);
    folding = true;
    listValue = /^[ \t]*(?:#.*)?$/.test(line.slice(cut));
    kept.push(`${line.slice(0, cut)}[secret]`);
  }
  return kept.join("\n");
}

export function scrubText(text) {
  let out = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[secret]");
  out = redactCredentialLines(out.replace(URL_PATTERN, trimUrl));
  out = out.replace(DIGEST_PATTERN, "Digest$1[secret]");
  out = out.replace(HEADER_PATTERN, (match, name, gap, value) => `${name}${gap}${value.match(/^(?:Bearer|Basic|Token)[ \t]+/i)?.[0] ?? ""}[secret]`);
  out = out.replace(URL_PATTERN, trimUrl);
  out = out.replace(KEY_VALUE_PATTERN, "$1$2[secret]");
  out = out.replace(SECRET_FLAG_PATTERN, "$1$2[secret]");
  out = out.replace(USER_FLAG_PATTERN, "$1$2[secret]");
  out = out.replace(COOKIE_PAIR_PATTERN, "$1$2[secret]");
  out = out.replace(AUTH_HEADER_PATTERN, (match, scheme, gap) => (match.endsWith("[secret]") ? match : `${scheme}${gap}[secret]`));
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
