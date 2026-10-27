import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { TriageData, TriageView } from "../server/triage/load";
import type { ReplyStatus } from "../server/triage/replies";
import { requireAllowed } from "./api";
import { TRIAGE_VIEWS } from "./triage-views";

const STATUSES: readonly ReplyStatus[] = ["drafted", "sent", "skipped"];

export const getTriage = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { view: string }) => {
    if (!(TRIAGE_VIEWS as readonly string[]).includes(input?.view)) throw new Error("Unknown triage view");
    return { view: input.view as TriageView };
  })
  .handler(async ({ data }) => {
    const { triageViews } = await import("../server/triage/load");
    const loader = triageViews[data.view] as (signal?: AbortSignal) => Promise<unknown>;
    return (await loader(getRequest().signal)) as object;
  });

export async function fetchTriage<V extends TriageView>(view: V, signal?: AbortSignal): Promise<TriageData<V>> {
  return (await getTriage({ data: { view }, signal })) as TriageData<V>;
}

export const updateReplyStatus = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { id: number; status: string }) => {
    const id = Number(input?.id);
    if (!Number.isInteger(id) || id <= 0 || id > 4_294_967_295) throw new Error("Not a reply id");
    if (!STATUSES.includes(input?.status as ReplyStatus)) throw new Error("Unknown reply status");
    return { id, status: input.status as ReplyStatus };
  })
  .handler(async ({ data, context }) => {
    const { setReplyStatus } = await import("../server/triage/replies");
    return setReplyStatus(data.id, data.status, context.email);
  });
