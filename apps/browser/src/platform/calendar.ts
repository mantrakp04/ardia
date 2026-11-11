import { nativeModule, type CalendarAccessRequest, type CalendarAuthorization, type CalendarParticipant, type SystemCalendar, type SystemCalendarEvent } from "@ardia/shell";

export type { CalendarAccessRequest, CalendarAuthorization, SystemCalendar, SystemCalendarEvent, CalendarParticipant };

const Calendar = nativeModule("ArdiaCalendar");

export const calendarAuthorization = (): CalendarAuthorization => Calendar.authorizationStatus();
export const requestCalendarAccess = async (): Promise<CalendarAccessRequest> => {
  const result: CalendarAccessRequest | boolean = await Calendar.requestAccess();
  if (typeof result !== "boolean") return result;
  return { granted: result, status: calendarAuthorization(), error: null, responsible: "unknown", ms: 0 };
};
export const systemCalendars = () => Calendar.calendars();
export const systemCalendarEvents = (start: number, end: number, calendarIds: string[] = []) => Calendar.events(start, end, calendarIds);
export const onCalendarChanged = (listener: () => void) => Calendar.addListener("onCalendarChanged", listener);
