type Producer = { quiesce(token: string): void; flush(): Promise<number>; resume(token: string): void };
const producers = new Set<Producer>();
export const registerDocumentProducer = (producer: Producer) => {
  producers.add(producer);
  return () => { producers.delete(producer); };
};
export const quiesceLinuxDocuments = (token: string) => { for (const producer of producers) producer.quiesce(token); };
export const resumeLinuxDocuments = (token: string) => { for (const producer of producers) producer.resume(token); };
export const flushLinuxDocuments = async () => {
  let watermark = 0;
  for (const producer of producers) watermark = Math.max(watermark, await producer.flush());
  return watermark;
};
