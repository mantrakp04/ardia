const BLANK = "about:blank";

type Fields = Record<string, unknown>;

export type OpeningPage = { ownsBlank: boolean; committed: boolean };

const isBlank = (url: unknown) => url === "" || url === BLANK;

export const openingPage = (url: string, adopted: boolean): OpeningPage => ({ ownsBlank: !adopted && !url.startsWith("about:"), committed: false });

export function noteLoadAsked(page: OpeningPage, url: unknown) {
  if (typeof url === "string" && url.startsWith("about:")) page.ownsBlank = false;
}

function shapedMedia(data: unknown) {
  const media = (data ?? {}) as { audible?: unknown; playing?: unknown; muted?: unknown };
  return { playing: media.playing === true || media.audible === true, muted: media.muted === true };
}

function shapedNavigation(page: OpeningPage, fields: Fields): Fields {
  if (typeof fields.committedUrl !== "string" || !isBlank(fields.committedUrl)) page.committed = true;
  if (page.committed || !page.ownsBlank) return fields;
  return {
    ...fields,
    url: fields.url === BLANK ? "" : fields.url,
    title: fields.title === BLANK ? "" : fields.title,
    committedInitial: true,
    initialDocumentAccessed: false,
  };
}

export function shapedPageEvent(page: OpeningPage, name: string, data: unknown): unknown {
  if (name === "media") return shapedMedia(data);
  const fields = (data ?? {}) as Fields;
  if (name === "navigation") return shapedNavigation(page, fields);
  if (name === "downloadNavigation" && (!page.committed || isBlank(fields.committedUrl))) return { ...fields, committedUrl: "" };
  return fields;
}
