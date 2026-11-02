import type { Adapter } from "../../platform/sync";
import { SEND, sendRecord, type SendRecord } from "./records";

export type SendLedger = { outgoing: Record<string, SendRecord>; received: Record<string, number> };
export type ReceivedSend = { key: string; send: SendRecord };

export const SEND_KEPT_MS = 7 * 86_400_000;
const RECEIVED_KEPT_MS = 90 * 86_400_000;
const MAX_SENT_URL = 8_192;

export const sendableUrl = (url: unknown): url is string => typeof url === "string" && url.length <= MAX_SENT_URL && /^https?:\/\/[^\s]/i.test(url);

export function sentTabsAdapter(deviceId: string, ledger: () => SendLedger, deliver: (sends: ReceivedSend[]) => boolean): Adapter {
  return {
    prefix: SEND,
    extract: (base, queued, now, known, remote) => {
      const { outgoing, received } = ledger();
      const values = new Map<string, unknown>();
      for (const [key, send] of Object.entries(outgoing)) {
        if (known(key)) {
          if (!queued(key)) delete outgoing[key];
        } else if (now - send.at >= SEND_KEPT_MS) delete outgoing[key];
        else values.set(key, send);
      }
      const awaitsReceipt = (key: string) => !known(key) || [base(key), remote(key)].some((value) => sendRecord(value)?.to === deviceId);
      for (const [key, at] of Object.entries(received)) {
        if ((known(key) && remote(key) === null && !queued(key)) || (now - at > RECEIVED_KEPT_MS && !awaitsReceipt(key))) delete received[key];
      }
      const receiveUnreceipted = (key: string, send: SendRecord) => {
        if (sendableUrl(send.u) && !deliver([{ key, send }])) return false;
        received[key] = now;
        return true;
      };
      const ignore = (key: string) => {
        const send = sendRecord(base(key));
        if (!send) return true;
        if (send.to === deviceId && send.from !== deviceId) return !(key in received) && !receiveUnreceipted(key, send);
        if (send.to === deviceId) return !(key in received);
        if (send.from === deviceId) return now - send.at < SEND_KEPT_MS;
        return true;
      };
      return {
        values,
        ignore,
        published: (keys) => {
          for (const key of keys) delete outgoing[key];
        },
      };
    },
    apply: (visible, changed, _base, records) => {
      const { received } = ledger();
      const arrived: ReceivedSend[] = [];
      const unusable: string[] = [];
      for (const key of changed) {
        const send = sendRecord(visible.get(key));
        if (!send || send.to !== deviceId || send.from === deviceId || key in received) continue;
        if (sendableUrl(send.u)) arrived.push({ key, send });
        else unusable.push(key);
      }
      arrived.sort((a, z) => a.send.at - z.send.at || (a.key < z.key ? -1 : 1));
      if (arrived.length && !deliver(arrived)) return false;
      for (const { key } of arrived) received[key] = records.now;
      for (const key of unusable) received[key] = records.now;
      return true;
    },
  };
}
