const BLANK = "about:blank";

type Fields = Record<string, unknown>;

type BlankPage = "opening" | "engine" | "asked";

export type OpeningPage = { blank: BlankPage; committed: boolean; downloaded: boolean };

const isBlank = (url: unknown) => url === "" || url === BLANK;

const asksForBlank = (url: unknown) => typeof url === "string" && url.startsWith("about:");

export const openingPage = (url: string, adopted: boolean): OpeningPage => ({
  blank: adopted ? "engine" : asksForBlank(url) ? "asked" : "opening",
  committed: false,
  downloaded: false,
});

export function noteLoadAsked(page: OpeningPage, url: unknown) {
  page.downloaded = false;
  if (asksForBlank(url)) page.blank = "asked";
}

function shapedMedia(data: unknown) {
  const media = (data ?? {}) as { audible?: unknown; playing?: unknown; muted?: unknown };
  return { playing: media.playing === true || media.audible === true, muted: media.muted === true };
}

function shapedNavigation(page: OpeningPage, fields: Fields): Fields {
  if (typeof fields.committedUrl !== "string" || !isBlank(fields.committedUrl)) page.committed = true;
  if (page.committed || page.blank === "asked") return fields;
  const leftByDownload = page.downloaded && fields.isLoading === false;
  if (page.blank === "engine") return leftByDownload ? { ...fields, url: "", title: "" } : fields;
  return {
    ...fields,
    url: leftByDownload || fields.url === BLANK ? "" : fields.url,
    title: leftByDownload || fields.title === BLANK ? "" : fields.title,
    committedInitial: true,
    initialDocumentAccessed: false,
  };
}

function shapedDownload(page: OpeningPage, fields: Fields): Fields {
  if (page.committed || page.blank === "asked") return fields;
  page.downloaded = true;
  return { ...fields, committedUrl: "" };
}

export function shapedPageEvent(page: OpeningPage, name: string, data: unknown): unknown {
  if (name === "media") return shapedMedia(data);
  const fields = (data ?? {}) as Fields;
  if (name === "navigation") return shapedNavigation(page, fields);
  if (name === "downloadNavigation") return shapedDownload(page, fields);
  return fields;
}
