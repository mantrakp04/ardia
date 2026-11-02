import { domainModule } from "./engine/call";
import type { CardInput } from "./autofill";
import type { SwipeModule } from "./swipe";

type Secret = Promise<string>;

export type ArdiaCoreNativeModules = {
  ArdiaTabs: {
    prepareTransfer(tabId: string): void;
    releaseTransfer(tabId: string): void;
    claimLaunchTab(tabId: string, url: string, profile: string): void;
    revealTab(tabId: string): void;
    dropTabReveals(tabId: string): void;
    revealOffered(adoptId: string, overTabId: string): void;
  };
  ArdiaEngine: { inputIdleSeconds(): number };
  ArdiaPasswords: {
    save(profile: string, origin: string, username: string, password: string): Secret;
    update(profile: string, origin: string, username: string, newUsername: string | null, newPassword: string | null): Secret;
  };
  ArdiaAutofill: { saveCard(profile: string, card: CardInput, number: string | null): Secret };
  ArdiaSwipe: SwipeModule;
};

const domainOfModule = (name: string) => `${name[5]!.toLowerCase()}${name.slice(6)}`;

export const nativeModule = <Name extends keyof ArdiaCoreNativeModules>(name: Name) =>
  domainModule<ArdiaCoreNativeModules[Name]>(domainOfModule(name));
