import type { LivePersistenceBinding } from "../../browser/src/platform/livePersistence";
import { ardiaHost } from "./host";
import { createLiveDocumentClient } from "./liveDocumentClient";
import { registerDocumentProducer } from "./documentFlush";
import { documentError } from "./liveDocumentTypes";

export function createLivePersistence(): LivePersistenceBinding {
  if (!ardiaHost) throw documentError("ERR_DOCUMENT_AUTH", "Linux Live persistence requires a native shell");
  const client = createLiveDocumentClient(ardiaHost);
  registerDocumentProducer(client);
  return {
    load: () => ({}),
    start: client.start,
    changed: client.changed,
    newFolderId: () => `lf-${crypto.randomUUID()}`,
    completionFence: client.completionFence,
    beginRefresh: client.beginRefresh,
  };
}
