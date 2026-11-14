import { createFileRoute } from "@tanstack/react-router";

const REPORT_ID = /^(FB-[A-Z0-9]{3,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const FILE_NAME = /^[\w-][\w.-]{0,119}$/;
const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];
const PLAYABLE = /\.(mp4|png|jpe?g|gif|webp)$/i;
const TYPES: Record<string, string> = { mp4: "video/mp4", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", gz: "application/gzip", ips: "text/plain; charset=utf-8", json: "application/json", txt: "text/plain; charset=utf-8" };

const plain = (status: number, text: string) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export const Route = createFileRoute("/files/feedback/$id/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { currentViewer } = await import("../../../../server/auth");
        const viewer = await currentViewer();
        if (viewer.state !== "allowed") return plain(viewer.state === "signed-out" ? 401 : 403, "Not allowed");
        if (!REPORT_ID.test(params.id) || !FILE_NAME.test(params.name)) return plain(400, "Bad file");
        const { feedbackFilesBases, feedbackFilesHeaders } = await import("../../../../server/feedback-reports");
        const bases = feedbackFilesBases();
        if (!bases.length) return plain(503, "Feedback storage is not configured: set FEEDBACK_FILES_URL, FEEDBACK_OBJECTS_HOST or REPLAYS_HOST");
        const range = request.headers.get("range");
        let upstream: Response | undefined;
        try {
          for (const base of bases) {
            upstream = await fetch(`${base}${encodeURIComponent(params.id)}/${encodeURIComponent(params.name)}`, {
              headers: { ...feedbackFilesHeaders(), ...(range ? { Range: range } : {}) },
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
            });
            if (upstream.status !== 404) break;
          }
        } catch (error) {
          return plain(502, `Feedback storage unreachable (${(error as Error).message})`);
        }
        if (!upstream || upstream.status === 404) return plain(404, "No such file");
        if (!upstream.ok) return plain(502, `Feedback storage: ${upstream.status}`);
        const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
        for (const name of PASSED_HEADERS) {
          const value = upstream.headers.get(name);
          if (value) headers.set(name, value);
        }
        const ext = params.name.split(".").pop()?.toLowerCase() ?? "";
        headers.set("Content-Type", TYPES[ext] ?? "application/octet-stream");
        headers.set("Content-Disposition", `${PLAYABLE.test(params.name) ? "inline" : "attachment"}; filename="${params.id}-${params.name}"`);
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
