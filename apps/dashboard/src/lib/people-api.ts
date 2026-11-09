import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAllowed } from "./api";

export const PEOPLE_SORT_KEYS = ["last", "first", "crashes", "reports"] as const;
export const PEOPLE_FILTERS = ["", "crashed", "reported", "cli", "watching"] as const;
export type PeopleSortKey = (typeof PEOPLE_SORT_KEYS)[number];
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number];
export type ChannelFilter = "" | "stable" | "nightly";

const PERSON_ID = /^[\w-]{6,64}$/;
const REPORT_ID = /^(FB-[A-Z0-9]{3,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const VERSION = /^0\.\d+\.\d+(-nightly\.\d+)?$/;

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

export const getPeople = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { search?: string; page?: number; sort?: string; channel?: string; only?: string }) => ({
    search: String(input?.search ?? "").slice(0, 64),
    page: Math.max(1, Math.min(10_000, Math.floor(Number(input?.page) || 1))),
    sort: pick(input?.sort, PEOPLE_SORT_KEYS, "last"),
    channel: pick(input?.channel, ["", "stable", "nightly"] as const, ""),
    only: pick(input?.only, PEOPLE_FILTERS, ""),
  }))
  .handler(async ({ data }) => {
    const { listPeople } = await import("../server/people");
    return listPeople(data, getRequest().signal);
  });

export const getPerson = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { id: string; before?: number | null }) => {
    const id = String(input?.id ?? "");
    if (!PERSON_ID.test(id)) throw new Error("Not an install id");
    const before = Number(input?.before);
    return { id, before: Number.isFinite(before) && before > 0 ? before : null };
  })
  .handler(async ({ data }) => {
    const { getPerson: load } = await import("../server/people");
    return load(data.id, data.before, getRequest().signal);
  });

export const getFeedbackList = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .handler(async () => {
    const { listFeedback } = await import("../server/feedback-reports");
    return listFeedback(getRequest().signal);
  });

export const getFeedbackReport = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { id: string }) => {
    const id = String(input?.id ?? "");
    if (!REPORT_ID.test(id)) throw new Error("Not a report id");
    return { id };
  })
  .handler(async ({ data }) => {
    const { getFeedbackReport: load } = await import("../server/feedback-reports");
    return load(data.id, getRequest().signal);
  });

export const getRegressions = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { channel?: string; latest?: string; previous?: string }) => ({
    channel: pick(input?.channel, ["stable", "nightly"] as const, "nightly"),
    latest: VERSION.test(String(input?.latest ?? "")) ? String(input!.latest) : undefined,
    previous: VERSION.test(String(input?.previous ?? "")) ? String(input!.previous) : undefined,
  }))
  .handler(async ({ data }) => {
    const { getRegressions: load } = await import("../server/regressions");
    return load(data, getRequest().signal);
  });
