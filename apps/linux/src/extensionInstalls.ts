import { installExtension as sharedInstallExtension } from "../../browser/src/platform/extensions";
import { useExtensions } from "./extensionsStore";
import { followInstallFailures } from "./installRequestSheet";

export * from "../../browser/src/platform/extensions";

const failures = followInstallFailures(useExtensions);

export const installExtension: typeof sharedInstallExtension = (pkg, profile) =>
  sharedInstallExtension(pkg, profile).catch((error: unknown) => {
    failures.failed(pkg);
    throw error;
  });
