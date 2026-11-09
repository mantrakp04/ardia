import { nativeModule, type UserScriptsFolder } from "@ardia/shell";

export type { UserScriptsFolder };

const UserScripts = nativeModule("ArdiaUserScripts");

export const watchUserScripts = (on: boolean) => UserScripts.watch(on);
export const readUserScripts = () => UserScripts.read();
export const readUserScriptsStatus = () => UserScripts.readStatus();
export const writeUserScriptsStatus = (json: string) => UserScripts.writeStatus(json);
export const onUserScriptsChange = (listener: () => void) => UserScripts.addListener("onChange", listener);
