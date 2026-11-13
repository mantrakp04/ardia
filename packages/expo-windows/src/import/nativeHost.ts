import { TurboModuleRegistry } from "react-native";
import type { WindowsImportModule } from "../nativeModuleTypes";
import type { ImportHost, Query } from "./host";

export const NATIVE_IMPORT = "ArdiaWindowsImport";

const parsed = async <Value>(promise: Promise<string>): Promise<Value> => JSON.parse(await promise) as Value;

export function nativeImportHost(): ImportHost | null {
  const native = TurboModuleRegistry.get<WindowsImportModule>(NATIVE_IMPORT);
  if (!native) return null;
  const constants = native.getConstants?.() ?? {};
  return {
    localAppData: typeof constants.localAppData === "string" ? constants.localAppData : "",
    roamingAppData: typeof constants.roamingAppData === "string" ? constants.roamingAppData : "",
    list: (path) => parsed(native.list(path)),
    readText: (path, largest) => native.readText(path, largest),
    readBase64: (path, largest) => native.readBase64(path, largest),
    query: (path, queries) => parsed(native.query(path, queries)),
    openSnapshot: (path) => parsed(native.openSnapshot(path)),
    querySnapshot: (id, queries) => parsed(native.querySnapshot(id, queries)),
    closeSnapshot: (id) => native.closeSnapshot(id),
    unlock: (browserId, localState) => parsed(native.unlock(browserId, localState)),
    logins: (browserId, files) => parsed(native.logins(browserId, files)),
    cookies: (browserId, file) => parsed(native.cookies(browserId, file)),
    writeCookies: (token, profile) => parsed(native.writeCookies(token, profile)),
    discard: (token) => native.discard(token),
    forget: () => native.forget(),
  };
}
