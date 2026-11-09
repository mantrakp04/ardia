export const DEV_EVAL_SCRIPT = "dev-eval.js";
export const DEV_EVAL_RESULT = "dev-eval-result.json";

const scriptId = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];

export function watchDevEval(read: (name: string) => string | null, everyMs: number, run: (id: string, source: string) => void) {
  let lastId = scriptId(read(DEV_EVAL_SCRIPT)) ?? "";
  setInterval(() => {
    const source = read(DEV_EVAL_SCRIPT);
    const id = scriptId(source);
    if (!source || !id || id === lastId) return;
    lastId = id;
    run(id, source);
  }, everyMs);
}
