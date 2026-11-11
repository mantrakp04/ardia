import { listTasks, type EngineTask } from "../../platform/performance";
import { useBrowser } from "../browser/store";
import { capture } from "./client";
import { noteAppMemory } from "./diagnostics";

const HOUR_MS = 60 * 60_000;

const mb = (bytes: number) => Math.round(bytes / 1_048_576);

export async function sampleMemory(startedAt: number) {
  try {
    await listTasks().catch((): EngineTask[] => []);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const tasks = await listTasks().catch((): EngineTask[] => []);
    let total = 0;
    let browser = 0;
    let gpu = 0;
    let renderers = 0;
    for (const t of tasks) {
      const m = Math.max(0, t.memory);
      total += m;
      if (t.type === "browser") browser += m;
      else if (t.type === "gpu") gpu += m;
      else if (t.type === "renderer") renderers++;
    }
    if (!total) return;
    noteAppMemory(mb(total));
    capture("perf_memory", {
      total_mb: mb(total),
      browser_mb: mb(browser),
      gpu_mb: mb(gpu),
      renderer_processes: renderers,
      tabs: Object.keys(useBrowser.getState().tabs).length,
      uptime_hours: Math.round((Date.now() - startedAt) / HOUR_MS),
    });
  } catch {}
}
