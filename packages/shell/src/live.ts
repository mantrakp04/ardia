import type { EventSubscription } from "expo-modules-core";

export type CalendarAuthorization = "fullAccess" | "writeOnly" | "denied" | "restricted" | "notDetermined";

export type SystemCalendar = {
  id: string;
  title: string;
  color: string;
  account: string;
  accountType: "local" | "exchange" | "calDAV" | "subscribed" | "birthdays" | "other";
  owned: boolean;
};

export type CalendarParticipant = { name: string; email: string; status: "accepted" | "declined" | "tentative" | "pending"; me: boolean };

export type SystemCalendarEvent = {
  id: string;
  occurrence: string;
  calendarId: string;
  color: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
  cancelled: boolean;
  declined: boolean;
  organizer: CalendarParticipant | null;
  attendees: CalendarParticipant[];
};

export type CalendarNative = {
  addListener(name: "onCalendarChanged", listener: () => void): EventSubscription;
  authorizationStatus(): CalendarAuthorization;
  requestAccess(): Promise<boolean>;
  calendars(): Promise<SystemCalendar[]>;
  events(start: number, end: number, calendarIds: string[]): Promise<SystemCalendarEvent[]>;
};

export type KeychainNative = {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<boolean>;
  delete(account: string): Promise<boolean>;
};
