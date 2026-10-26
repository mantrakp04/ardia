import { domainModule } from "./engine/call";
import type { CardInput } from "./autofill";
import type { SwipeModule } from "./swipe";

type Secret = Promise<string>;

export type ArdiaCoreNativeModules = {
  ArdiaTabs: {
    prepareTransfer(key: string): void;
    releaseTransfer(key: string): void;
    claimLaunchTab(key: string, url: string, profile: string): void;
    revealTab(key: string): void;
    dropTabReveals(key: string): void;
    revealOffered(adoptId: string, key: string): void;
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
