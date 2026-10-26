export type BriefSource = { kind: "github" | "gmail"; url: string; project?: string };
export type BriefItem = { title: string; body: string; source?: BriefSource };
export type BriefLink = { title: string; url: string; kind?: "github" | "gmail" };
export type BriefContent = { summary: string; focus: BriefItem & { links?: BriefLink[] }; todos: BriefItem[]; updates: BriefItem[]; events: (BriefItem & { time: string; start?: string; end?: string; allDay?: boolean })[] };

function briefSource(value: unknown): BriefSource | undefined {
  const source = typeof value === "string" ? { url: value } : value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!source || typeof source.url !== "string") return;
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(source.url)) return { kind: "github", url: source.url, ...(typeof source.project === "string" ? { project: source.project.slice(0, 120) } : {}) };
  if (/^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/[a-fA-F0-9]+$/.test(source.url)) return { kind: "gmail", url: source.url };
  const accountMessage = source.url.match(/^https:\/\/mail\.google\.com\/mail\/u\/\?authuser=([^&#]+)#all\/([a-fA-F0-9]+)$/);
  if (accountMessage) {
    try {
      const expected = gmailBriefUrl(decodeURIComponent(accountMessage[1]!), accountMessage[2]!);
      if (expected === source.url) return { kind: "gmail", url: source.url };
    } catch {}
  }
}

export function gmailBriefUrl(email: string | undefined, id: string): string | undefined {
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-fA-F0-9]{1,128}$/.test(id)) return;
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${id}`;
}

export function isSafeBriefSource(source: BriefSource): boolean {
  return briefSource(source)?.kind === source.kind;
}

export function parseBriefContent(raw: string): BriefContent {
  const content = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
  const text = (value: unknown, limit: number): string => {
    if (typeof value !== "string") throw new Error("The provider returned an invalid brief. Try again.");
    return value.slice(0, limit);
  };
  const item = (value: unknown): BriefItem => {
    if (!value || typeof value !== "object") throw new Error("The provider returned an invalid brief. Try again.");
    const v = value as Record<string, unknown>;
    const source = briefSource(v.sourceUrl ?? v.source ?? v.url);
    return { title: text(v.title, 240), body: text(v.body, 2400), ...(source ? { source } : {}) };
  };
  const items = (value: unknown): BriefItem[] => {
    if (!Array.isArray(value)) throw new Error("The provider returned an invalid brief. Try again.");
    return value.slice(0, 12).map(item);
  };
  if (!content || typeof content !== "object" || !Array.isArray(content.events)) throw new Error("The provider returned an invalid brief. Try again.");
  const focus: BriefContent["focus"] = item(content.focus);
  const sources = content.focus.sourceUrls ?? content.focus.links;
  if (Array.isArray(sources)) {
    focus.links = sources.slice(0, 5).flatMap((source: unknown) => {
      const value = typeof source === "string" ? { url: source, title: source } : source && typeof source === "object" ? source as Record<string, unknown> : null;
      const bound = briefSource(value);
      if (!value || !bound) return [];
      return [{ url: bound.url, title: typeof value.title === "string" ? value.title.slice(0, 240) : bound.url, ...(bound.kind === "gmail" ? { kind: bound.kind } : {}) }];
    });
  }
  return { summary: text(content.summary, 600), focus, todos: items(content.todos), updates: items(content.updates), events: content.events.slice(0, 20).map((event: Record<string, unknown>) => ({ ...item(event), time: text(event.time, 80), ...(typeof event.start === "string" ? { start: text(event.start, 80) } : {}), ...(typeof event.end === "string" ? { end: text(event.end, 80) } : {}), ...(typeof event.allDay === "boolean" ? { allDay: event.allDay } : {}) })) };
}

function sourceTitleMatches(item: BriefItem, title: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const description = normalize(`${item.title} ${item.body}`);
  const normalized = normalize(title);
  const ignored = new Set(["the", "and", "for", "with", "from", "your", "this", "that", "into", "pull", "request", "update", "review", "gmail", "message", "email", "notification"]);
  const tokens = [...new Set(normalized.split(" ").filter((token) => token.length >= 3 && !ignored.has(token)))];
  if (normalized.length >= 12 && tokens.length >= 2 && ` ${description} `.includes(` ${normalized} `)) return true;
  const words = new Set(description.split(" "));
  const matches = tokens.filter((token) => words.has(token)).length;
  return tokens.length >= 3 && matches >= 3 && matches / tokens.length >= 0.8;
}

export function focusDisplayLinks(focus: BriefContent["focus"]): BriefLink[] {
  const links = (focus.links ?? []).filter((link, index, all) => !!briefSource(link.url) && all.findIndex((other) => other.url === link.url) === index);
  const description = `${focus.title} ${focus.body}`;
  const exactUrls = new Set(description.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*/g) ?? []);
  const numbers = new Set([...description.matchAll(/(?:#|\bPR\s*#?|\bpull request\s*#?)([1-9]\d*)\b/gi)].map((match) => match[1]));
  const github = links.filter((link) => briefSource(link.url)?.kind === "github");
  if (!numbers.size && !exactUrls.size) {
    if (!/\bPRs?\b|\bpull requests?\b/i.test(description)) return links;
    const titled = github.filter((link) => sourceTitleMatches(focus, link.title));
    return titled.length === 1 ? titled : [];
  }
  const plainText = description.replace(/https:\/\/\S+/g, "");
  const repos = new Set((plainText.match(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g) ?? []).map((repo) => repo.toLowerCase()));
  return github.filter((link) => {
    if (exactUrls.has(link.url)) return true;
    const parts = link.url.split("/");
    const number = parts.at(-1)!;
    if (!numbers.has(number)) return false;
    if (repos.size) return repos.has(`${parts[3]}/${parts[4]}`.toLowerCase());
    return github.filter((candidate) => candidate.url.split("/").at(-1) === number).length === 1;
  });
}

export function focusBriefLinks(focus: BriefContent["focus"], candidates: BriefLink[], matchTitles = true): BriefLink[] {
  const requested = new Set([...(focus.links?.map((link) => link.url) ?? []), ...(focus.source ? [focus.source.url] : [])]);
  const description = `${focus.title} ${focus.body}`;
  const mentionedUrls = new Set(description.match(/https:\/\/(?:github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*|mail\.google\.com\/mail\/u\/(?:0\/|\?authuser=[^&#\s]+)#all\/[a-fA-F0-9]+)/g) ?? []);
  const numbers = [...description.matchAll(/(?:#|\bPR\s*#?|\bpull request\s*#?)([1-9]\d*)\b/gi)].map((match) => match[1]);
  const explicit = candidates.filter((candidate) => {
    const source = briefSource(candidate.url);
    if (!source) return false;
    if (requested.has(candidate.url) || mentionedUrls.has(candidate.url)) return true;
    if (source.kind === "github") {
      const number = candidate.url.split("/").at(-1)!;
      if (numbers.includes(number) && candidates.filter((other) => other.url.split("/").at(-1) === number).length === 1) return true;
    }
    return false;
  });
  const titled = matchTitles && !explicit.length ? candidates.filter((candidate) => !!briefSource(candidate.url) && sourceTitleMatches(focus, candidate.title)) : [];
  const matched = explicit.length ? explicit : titled.length === 1 ? titled : [];
  const bound = matched.filter((candidate, index, all) => all.findIndex((other) => other.url === candidate.url) === index).slice(0, 5).map(({ title, url, kind }) => ({ title: title.slice(0, 240), url, ...(kind ? { kind } : {}) }));
  return matchTitles ? focusDisplayLinks({ ...focus, links: bound }) : bound;
}

export function updateBriefSource(item: BriefItem, github: (BriefLink & { repository?: string })[], gmail: { id: string; url?: string; subject?: string }[]): BriefSource | undefined {
  const candidates: BriefSource[] = [
    ...github.flatMap(({ url, repository }) => {
      const source = briefSource(url);
      return source?.kind === "github" ? [{ ...source, project: (repository ?? url.split("/")[4]!).split("/").at(-1)!.slice(0, 120) }] : [];
    }),
    ...gmail.flatMap(({ url }) => {
      const source = briefSource(url);
      return source?.kind === "gmail" ? [source] : [];
    }),
  ];
  if (item.source) return candidates.find((source) => source.url === item.source?.url);
  const referencedGithub = focusBriefLinks(item, github, false);
  const description = `${item.title} ${item.body}`;
  const mentionedUrls = new Set(description.match(/https:\/\/mail\.google\.com\/mail\/u\/(?:0\/|\?authuser=[^&#\s]+)#all\/[a-fA-F0-9]+/g) ?? []);
  const referencedGmail = gmail.filter(({ id, url }) => !!url && (mentionedUrls.has(url) || /^[a-fA-F0-9]{10,128}$/.test(id) && new RegExp(`(^|[^a-zA-Z0-9])${id}([^a-zA-Z0-9]|$)`).test(description))).map(({ url }) => url);
  const mentioned = new Set([...referencedGithub.map(({ url }) => url), ...referencedGmail]);
  const matches = candidates.filter(({ url }) => mentioned.has(url));
  if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  const titles = [...github.map(({ title, url }) => ({ title, url })), ...gmail.map(({ subject, url }) => ({ title: subject ?? "", url }))];
  const titled = candidates.filter((candidate) => titles.some(({ title, url }) => url === candidate.url && sourceTitleMatches(item, title)));
  return titled.length === 1 ? titled[0] : undefined;
}

export function briefSummary(value: string): string {
  const text = value.replace(/^\s*(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\s*[:—–-]\s*/i, "").replace(/\s+/g, " ").trim();
  const sentences = (text.match(/.*?[.!?](?=\s+[A-Z]|$)|.+$/g) ?? []).slice(0, 2).map((sentence) => sentence.trim()).join(" ").trim();
  if (sentences.length <= 160) return sentences;
  const boundary = sentences.slice(0, 160).lastIndexOf(" ");
  return `${sentences.slice(0, boundary > 100 ? boundary : 159).replace(/[,:;—–-]+$/, "").trimEnd()}…`;
}


export function briefEventTime(event: BriefContent["events"][number], timeZone?: string): { start: string; range: string; body: string } {
  if (event.allDay || /^all[ -]day$/i.test(event.time.trim())) return { start: "All day", range: "All day", body: event.body };
  let start = event.start ? new Date(event.start) : null;
  let end = event.end ? new Date(event.end) : null;
  if (!start || !Number.isFinite(start.getTime())) {
    const raw = event.time.trim();
    const dated = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\s*(?:[–—-]\s*(\d{2}:\d{2}))?\s*(UTC|GMT)?$/i);
    if (dated) {
      const zone = dated[3] || (dated[5] ? "Z" : "");
      start = new Date(`${dated[1]}T${dated[2]}:00${zone}`);
      if (dated[4]) end = new Date(`${dated[1]}T${dated[4]}:00${zone}`);
    } else {
      const times = [...raw.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)];
      const local = (match: RegExpMatchArray | undefined) => {
        if (!match) return null;
        let hour = Number(match[1]);
        const minute = Number(match[2]);
        if (minute > 59 || hour > (match[3] ? 12 : 23)) return null;
        if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
        const date = new Date();
        date.setHours(hour, minute, 0, 0);
        return date;
      };
      start = local(times[0]);
      end = local(times[1]);
    }
  }
  if (!start || !Number.isFinite(start.getTime())) return { start: "TBD", range: "Time to be confirmed", body: event.body };
  const format = (date: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...(timeZone ? { timeZone } : {}) }).format(date).replace(/\s+/g, " ");
  const startLabel = format(start);
  const validEnd = end && Number.isFinite(end.getTime()) ? end : null;
  const minutes = validEnd ? Math.round((validEnd.getTime() - start.getTime()) / 60_000) : 0;
  const duration = minutes > 0 ? minutes % 60 === 0 ? `${minutes / 60}-hour calendar event.` : `${minutes}-minute calendar event.` : "Calendar event.";
  const body = /\bUTC\b|\bGMT\b|\btime ?zone\b|\d{4}-\d{2}-\d{2}/i.test(event.body) ? duration : event.body;
  return { start: startLabel.replace(/\s/g, "").toLowerCase(), range: validEnd ? `${startLabel} – ${format(validEnd)}` : startLabel, body };
}
