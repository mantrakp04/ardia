import { type ImportHost, type Query, type Rows, type SnapshotFailure } from "./host";
import { ImportFailure } from "./model";

const fileName = (path: string) => path.slice(path.lastIndexOf("\\") + 1);

export function snapshotFailure(failure: SnapshotFailure, path: string, browserName = "the browser"): ImportFailure {
  if (failure === "missing") return new ImportFailure("notFound", `${fileName(path)} not found`);
  if (failure === "inUse") return new ImportFailure("locked", `${browserName} is holding ${fileName(path)}. Quit ${browserName} and import again`);
  return new ImportFailure("unreadable", `Couldn't read ${fileName(path)}`);
}

export async function readRows(host: ImportHost, path: string, queries: Query[], browserName?: string): Promise<Rows[]> {
  const answer = await host.query(path, queries);
  if ("failure" in answer) throw snapshotFailure(answer.failure, path, browserName);
  const failed = answer.results.find((r) => r.error);
  if (failed?.error) throw new ImportFailure("unreadable", failed.error);
  return answer.results;
}
