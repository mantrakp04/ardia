import { BadArgs, ok, type Handlers } from "./calling";

type Reply = { status: number; text(): Promise<string> };
type Fetch = (url: string, options: { signal: AbortSignal }) => Promise<Reply>;

export function suggestCalls(fetchPage: Fetch = (url, options) => fetch(url, options)): Handlers {
  const running = new Map<number, AbortController>();
  return {
    suggest: async (args) => {
      const url = args.text("url");
      const id = args.double("id");
      if (!/^https?:\/\//i.test(url)) throw new BadArgs("url isn't a web address");
      const request = new AbortController();
      running.set(id, request);
      try {
        const reply = await fetchPage(url, { signal: request.signal });
        const body = await reply.text();
        return ok(request.signal.aborted ? { stopped: true } : { status: reply.status, body });
      } catch {
        return ok(request.signal.aborted ? { stopped: true } : { status: 0, body: "" });
      } finally {
        if (running.get(id) === request) running.delete(id);
      }
    },
    stopSuggest: async (args) => {
      running.get(args.double("id"))?.abort();
      return ok();
    },
  };
}
