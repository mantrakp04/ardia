import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import type { SectionData, SectionName } from "../server/sections";
import { parseRange } from "./range";
import { SECTION_NAMES } from "./section-names";

const noStore = createMiddleware({ type: "function" }).server(async ({ next }) => {
  setResponseHeader("Cache-Control", "private, no-store");
  return next();
});

export const requireAllowed = createMiddleware({ type: "function" })
  .middleware([noStore])
  .server(async ({ next }) => {
    const { currentViewer } = await import("../server/auth");
    const viewer = await currentViewer();
    if (viewer.state !== "allowed") {
      setResponseStatus(viewer.state === "signed-out" ? 401 : 403);
      throw new Error(viewer.state === "signed-out" ? "Sign in required" : "Not allowed");
    }
    return next({ context: { email: viewer.email } });
  });

export const getViewer = createServerFn({ method: "POST" })
  .middleware([noStore])
  .handler(async () => {
    const { currentViewer } = await import("../server/auth");
    return currentViewer();
  });

export const getSection = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { section: string; range?: string }) => {
    if (!SECTION_NAMES.includes(input?.section as SectionName)) throw new Error("Unknown section");
    return { section: input.section as SectionName, range: parseRange(input.range) };
  })
  .handler(async ({ data }) => {
    const { sections } = await import("../server/sections");
    const loader = sections[data.section] as (range: typeof data.range, signal?: AbortSignal) => Promise<unknown>;
    return (await loader(data.range, getRequest().signal)) as object;
  });

export async function fetchSection<N extends SectionName>(section: N, range: string, signal?: AbortSignal): Promise<SectionData<N>> {
  return (await getSection({ data: { section, range }, signal })) as SectionData<N>;
}

const SORTS = ["newest", "longest", "clicks"] as const;

export type ReplayListInput = {
  range?: string;
  page?: number;
  minDuration?: number;
  clicks?: boolean;
  device?: string;
  url?: string;
  download?: string;
  sort?: string;
};

export const getReplays = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: ReplayListInput) => ({
    range: parseRange(input?.range ?? "30d"),
    page: Math.max(1, Math.floor(Number(input?.page) || 1)),
    minDuration: Math.max(0, Math.min(86_400, Math.floor(Number(input?.minDuration) || 0))),
    clicks: input?.clicks === true,
    device: typeof input?.device === "string" ? input.device.slice(0, 40) : "",
    url: typeof input?.url === "string" ? input.url.slice(0, 200) : "",
    download: input?.download === "yes" ? ("yes" as const) : input?.download === "no" ? ("no" as const) : ("" as const),
    sort: (SORTS as readonly string[]).includes(input?.sort ?? "") ? (input!.sort as (typeof SORTS)[number]) : "newest",
  }))
  .handler(async ({ data }) => {
    const { listReplays } = await import("../server/replays");
    return listReplays(data, getRequest().signal);
  });

export const getReplay = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { sessionId: string }) => {
    const id = String(input?.sessionId ?? "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error("Not a session id");
    return { sessionId: id };
  })
  .handler(async ({ data }) => {
    const { getReplay: load } = await import("../server/replays");
    return load(data.sessionId, getRequest().signal);
  });
