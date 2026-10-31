import type { LiveCompletionInvalidation, LivePersistenceIntent, LiveProjection } from "../../browser/src/platform/livePersistence";
import { equalDocumentValue, type DocumentSnapshot } from "./liveDocumentTypes";

type Ticket = { folderId: string; fence: unknown; epoch: string; incarnation: string; owner: string; generation?: number; ids: Set<string>; expected: Map<string, unknown> };
const entries = (payload: LiveProjection, folderId: string): any[] => (payload.completed as Record<string, any[]> | undefined)?.[folderId] ?? [];

export function createLiveCompletionTickets() {
  const tickets = new Map<unknown, Ticket>();
  const invalidated: LiveCompletionInvalidation[] = [];
  const invalidate = (ticket: Ticket | undefined) => {
    if (!ticket || tickets.get(ticket.fence) !== ticket) return;
    tickets.delete(ticket.fence);
    invalidated.push({ folderId: ticket.folderId, fence: ticket.fence });
  };
  const valid = (ticket: Ticket, snapshot: DocumentSnapshot) => ticket.generation !== undefined && ticket.epoch === snapshot.epoch && ticket.incarnation === snapshot.incarnations[ticket.folderId] && ticket.owner === snapshot.clientId && ticket.generation === snapshot.generations[ticket.folderId] && [...ticket.expected].every(([id, expected]) => entries(snapshot.payload, ticket.folderId).some((entry) => entry.item.id === id && equalDocumentValue(entry, expected)));
  return {
    capture: (intent: LivePersistenceIntent | undefined, before: LiveProjection, after: LiveProjection, snapshot: DocumentSnapshot) => {
      if (intent?.kind !== "refresh" || !intent.completionIds?.length) return;
      const fence = intent.fence as { owner: string; incarnation?: string };
      const previous = new Map(entries(before, intent.folderId).map((entry) => [entry.item.id, entry]));
      const ticket: Ticket = { folderId: intent.folderId, fence, epoch: snapshot.epoch, incarnation: fence.incarnation ?? snapshot.incarnations[intent.folderId]!, owner: fence.owner, ids: new Set(intent.completionIds ?? []), expected: new Map(entries(after, intent.folderId).filter((entry) => !equalDocumentValue(previous.get(entry.item.id), entry)).map((entry) => [entry.item.id, entry])) };
      tickets.set(fence, ticket);
      return ticket;
    },
    settled: (ticket: Ticket | undefined, reply: DocumentSnapshot, canonical: DocumentSnapshot, superseded: boolean) => {
      if (!ticket || tickets.get(ticket.fence) !== ticket) return;
      ticket.generation = reply.generations[ticket.folderId];
      if (superseded || ticket.generation === undefined || !valid(ticket, canonical)) invalidate(ticket);
    },
    observe: (snapshot: DocumentSnapshot) => {
      for (const ticket of tickets.values()) if (ticket.generation !== undefined && !valid(ticket, snapshot)) invalidate(ticket);
    },
    invalidate,
    takeInvalidations: () => invalidated.splice(0),
    completionFence: (folderId: string, ids: string[], fence: unknown, snapshot: DocumentSnapshot) => {
      const ticket = tickets.get(fence);
      if (!ticket || ticket.folderId !== folderId) return null;
      if (!valid(ticket, snapshot) || !ids.every((id) => ticket.ids.has(id))) { invalidate(ticket); return null; }
      tickets.delete(fence);
      return { incarnation: ticket.incarnation, owner: ticket.owner, generation: ticket.generation };
    },
  };
}
