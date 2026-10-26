import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Native provider tests require macOS; bridge tests ran on this platform.");
} else {
  for (const name of ["brief-provider-test.mjs", "gmail-provider-test.mjs"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(name, import.meta.url))], { stdio: "inherit", timeout: 180_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
