import { requireOptionalNativeModule } from "expo-modules-core";

export type GmailStatus = { connected: boolean; email: string; clientSecretConfigured: boolean };
export type GmailMessage = { id: string; subject: string; from: string; date: string; snippet: string };

type GmailNative = {
  gmailStatus(): Promise<GmailStatus>;
  connectGmail(): Promise<GmailStatus>;
  cancelGmailSignIn(): Promise<void>;
  disconnectGmail(): Promise<boolean>;
  gmailMessages(): Promise<GmailMessage[]>;
  cancelGmailCollection(): Promise<void>;
  setGmailClientSecret(secret: string): Promise<void>;
};

const native = () => {
  const module = requireOptionalNativeModule<GmailNative>("ArdiaGmail");
  if (!module) throw new Error("Rebuild Ardia to connect Gmail.");
  return module;
};

export const gmailStatus = async () => native().gmailStatus();
export const connectGmail = async () => native().connectGmail();
export const cancelGmailSignIn = async () => native().cancelGmailSignIn();
export const disconnectGmail = async () => native().disconnectGmail();
export const gmailMessages = async () => native().gmailMessages();
export const cancelGmailCollection = async () => native().cancelGmailCollection();
export const setGmailClientSecret = async (secret: string) => native().setGmailClientSecret(secret);
