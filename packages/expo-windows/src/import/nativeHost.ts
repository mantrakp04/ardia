import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { ImportHost, Query } from "./host";

type Native = TurboModule & {
  getConstants?(): { localAppData?: unknown; roamingAppData?: unknown };
  list(path: string): Promise<string>;
  readText(path: string, largest: number): Promise<string | null>;
  readBase64(path: string, largest: number): Promise<string | null>;
  query(path: string, queries: Query[]): Promise<string>;
  unlock(browserId: string, localState: string): Promise<string>;
  logins(browserId: string, files: string[]): Promise<string>;
  cookies(browserId: string, file: string): Promise<string>;
  writeCookies(token: string, profile: string): Promise<string>;
  discard(token: string): void;
  forget(): void;
};

export const NATIVE_IMPORT = "ArdiaWindowsImport";

const parsed = async <Value>(promise: Promise<string>): Promise<Value> => JSON.parse(await promise) as Value;

export function nativeImportHost(): ImportHost | null {
  const native = TurboModuleRegistry.get<Native>(NATIVE_IMPORT);
  if (!native) return null;
  const constants: { localAppData?: unknown; roamingAppData?: unknown } = native.getConstants?.() ?? {};
  return {
    localAppData: typeof constants.localAppData === "string" ? constants.localAppData : "",
    roamingAppData: typeof constants.roamingAppData === "string" ? constants.roamingAppData : "",
    list: (path) => parsed(native.list(path)),
    readText: (path, largest) => native.readText(path, largest),
    readBase64: (path, largest) => native.readBase64(path, largest),
    query: (path, queries) => parsed(native.query(path, queries)),
    unlock: (browserId, localState) => parsed(native.unlock(browserId, localState)),
    logins: (browserId, files) => parsed(native.logins(browserId, files)),
    cookies: (browserId, file) => parsed(native.cookies(browserId, file)),
    writeCookies: (token, profile) => parsed(native.writeCookies(token, profile)),
    discard: (token) => native.discard(token),
    forget: () => native.forget(),
  };
}
