export class TooLarge extends Error {}

export async function readCapped(res: Response, cap: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel();
    throw new TooLarge();
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new TooLarge();
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
