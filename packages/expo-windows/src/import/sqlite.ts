import { type Answer, type ImportHost, type Query, type Rows, type SnapshotFailure } from "./host";
import { ImportFailure } from "./model";

const fileName = (path: string) => path.slice(path.lastIndexOf("\\") + 1);

export function snapshotFailure(failure: SnapshotFailure, path: string, browserName = "the browser"): ImportFailure {
  if (failure === "missing") return new ImportFailure("notFound", `${fileName(path)} not found`);
  if (failure === "inUse") return new ImportFailure("locked", `${browserName} is holding ${fileName(path)}. Quit ${browserName} and import again`);
  return new ImportFailure("unreadable", `Couldn't read ${fileName(path)}`);
}

function resultsOf(answer: Answer, path: string, browserName?: string): Rows[] {
  if ("failure" in answer) throw snapshotFailure(answer.failure, path, browserName);
  const failed = answer.results.find((r) => r.error);
  if (failed?.error) throw new ImportFailure("unreadable", failed.error);
  return answer.results;
}

export async function readRows(host: ImportHost, path: string, queries: Query[], browserName?: string): Promise<Rows[]> {
  return resultsOf(await host.query(path, queries), path, browserName);
}

export async function withSnapshot<Value>(
  host: ImportHost,
  path: string,
  browserName: string,
  use: (read: (queries: Query[]) => Promise<Rows[]>) => Promise<Value>,
): Promise<Value> {
  const opened = await host.openSnapshot(path);
  if ("failure" in opened) throw snapshotFailure(opened.failure, path, browserName);
  try {
    return await use(async (queries) => resultsOf(await host.querySnapshot(opened.id, queries), path, browserName));
  } finally {
    host.closeSnapshot(opened.id);
  }
}
