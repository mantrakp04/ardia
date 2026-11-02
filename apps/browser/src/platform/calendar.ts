import { nativeModule, type CalendarAuthorization, type CalendarParticipant, type SystemCalendar, type SystemCalendarEvent } from "@ardia/shell";

export type { CalendarAuthorization, SystemCalendar, SystemCalendarEvent, CalendarParticipant };

const Calendar = nativeModule("ArdiaCalendar");

export const calendarAuthorization = (): CalendarAuthorization => Calendar.authorizationStatus();
export const requestCalendarAccess = () => Calendar.requestAccess();
export const systemCalendars = () => Calendar.calendars();
export const systemCalendarEvents = (start: number, end: number, calendarIds: string[] = []) => Calendar.events(start, end, calendarIds);
export const onCalendarChanged = (listener: () => void) => Calendar.addListener("onCalendarChanged", listener);
