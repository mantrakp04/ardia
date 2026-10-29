import type { LiveProjection } from "../../browser/src/platform/livePersistence";

export type DocumentSnapshot = {
  document: "live.json";
  scope: string;
  epoch: string;
  revision: number;
  clientId: string;
  watermark: number;
  payload: LiveProjection;
  incarnations: Record<string, string>;
  generations: Record<string, number>;
};
export type FieldOperation = { type: "field"; target: "folder" | "calendar" | "config" | "account" | "meetingGroup" | "expandedStack" | "dismissedNow"; id?: string; incarnation?: string; field: string; expected: unknown; value: unknown };
export type DocumentOperation = FieldOperation
  | { type: "create"; id: string; incarnation: string; value: unknown }
  | { type: "delete"; id: string; incarnation: string }
  | { type: "place"; id: string; incarnation: string; after: string | null; expected: string | null }
  | { type: "member"; target: "hiddenCalendarIds" | "dismissedAlerts" | "known" | "unread"; id?: string; incarnation?: string; member: string; present: boolean }
  | { type: "entry"; target: "items" | "hidden" | "completed"; id: string; incarnation: string; key: string; expected: unknown; value: unknown }
  | { type: "claim"; id: string; incarnation: string }
  | { type: "refresh"; id: string; incarnation: string; generation: number; owner: string; operations: DocumentOperation[]; orders?: Partial<Record<"items" | "hidden" | "completed", string[]>> };
export type DocumentCommit = { document: "live.json"; epoch: string; requestId: string; observedRevision: number; operations: DocumentOperation[] };
export type DocumentReply = { status: "committed" | "conflict"; reason?: "notOwner"; superseded?: boolean; snapshot: DocumentSnapshot; requestId: string };
export type DocumentChange = { snapshot: DocumentSnapshot; clientId: string; requestId: string };
export const documentError = (code: string, message: string) => Object.assign(new Error(message), { code });
export const equalDocumentValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equalDocumentValue(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => equalDocumentValue(left[key], right[key]));
};
