import AppKit
import EventKit
import ExpoModulesCore

public class CalendarModule: Module {
  private var store = EKEventStore()
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ArdiaCalendar")
    Events("onCalendarChanged")

    OnStartObserving("onCalendarChanged") {
      self.observe()
    }

    OnStopObserving("onCalendarChanged") {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    Function("authorizationStatus") { () -> String in
      Self.status()
    }

    AsyncFunction("requestAccess") { (promise: Promise) in
      let asked = Self.status()
      let started = Date()
      self.store.requestFullAccessToEvents { granted, error in
        DispatchQueue.main.async {
          if granted { self.store = EKEventStore(); self.observe() }
          let status = Self.status()
          let responsible = Self.responsibleForSelf()
          if !granted {
            NSLog("[calendar] full access not granted: asked in %@, now %@, responsible %@, error %@", asked, status, responsible, error.map { "\($0)" } ?? "none")
          }
          promise.resolve([
            "granted": granted,
            "status": status,
            "error": error?.localizedDescription as Any,
            "responsible": responsible,
            "ms": Int(Date().timeIntervalSince(started) * 1000),
          ])
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("calendars") { () -> [[String: Any]] in
      guard Self.status() == "fullAccess" else { return [] }
      return self.store.calendars(for: .event).map { cal in
        [
          "id": cal.calendarIdentifier,
          "title": cal.title,
          "color": Self.hex(cal.color),
          "account": cal.source?.title ?? "",
          "accountType": Self.sourceType(cal.source?.sourceType),
          "owned": cal.allowsContentModifications && cal.type != .subscription && cal.type != .birthday,
        ]
      }
    }.runOnQueue(.main)

    AsyncFunction("events") { (start: Double, end: Double, calendarIds: [String]) -> [[String: Any]] in
      guard Self.status() == "fullAccess" else { return [] }
      let all = self.store.calendars(for: .event)
      let calendars = calendarIds.isEmpty ? all : all.filter { calendarIds.contains($0.calendarIdentifier) }
      guard !calendars.isEmpty else { return [] }
      let predicate = self.store.predicateForEvents(
        withStart: Date(timeIntervalSince1970: start / 1000),
        end: Date(timeIntervalSince1970: end / 1000),
        calendars: calendars
      )
      return self.store.events(matching: predicate).map(Self.serialize)
    }.runOnQueue(.main)
  }

  private func observe() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
      self?.sendEvent("onCalendarChanged", [:])
    }
  }

  private typealias ResponsiblePid = @convention(c) (pid_t) -> pid_t

  private static func responsibleForSelf() -> String {
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else { return "unknown" }
    let responsible = unsafeBitCast(symbol, to: ResponsiblePid.self)(getpid())
    if responsible <= 0 { return "unknown" }
    return responsible == getpid() ? "self" : "other"
  }

  private static func status() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess: return "fullAccess"
    case .writeOnly: return "writeOnly"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
  }

  private static func serialize(_ event: EKEvent) -> [String: Any] {
    let me = event.attendees?.first(where: { $0.isCurrentUser })
    return [
      "id": event.calendarItemIdentifier,
      "occurrence": "\(event.calendarItemIdentifier)@\(Int(event.startDate.timeIntervalSince1970))",
      "calendarId": event.calendar?.calendarIdentifier ?? "",
      "color": hex(event.calendar?.color),
      "title": event.title ?? "",
      "start": event.startDate.timeIntervalSince1970 * 1000,
      "end": event.endDate.timeIntervalSince1970 * 1000,
      "allDay": event.isAllDay,
      "location": event.location ?? "",
      "notes": event.notes ?? "",
      "url": event.url?.absoluteString ?? "",
      "cancelled": event.status == .canceled,
      "declined": me?.participantStatus == .declined,
      "organizer": event.organizer.map(participant) as Any,
      "attendees": (event.attendees ?? []).filter { $0.participantType != .room && $0.participantType != .resource }.map(participant),
    ]
  }

  private static func participant(_ p: EKParticipant) -> [String: Any] {
    let email = p.url.absoluteString.hasPrefix("mailto:") ? String(p.url.absoluteString.dropFirst(7)) : ""
    let status: String
    switch p.participantStatus {
    case .accepted: status = "accepted"
    case .declined: status = "declined"
    case .tentative: status = "tentative"
    default: status = "pending"
    }
    return ["name": p.name ?? "", "email": email, "status": status, "me": p.isCurrentUser]
  }

  private static func sourceType(_ type: EKSourceType?) -> String {
    switch type {
    case .local: return "local"
    case .exchange: return "exchange"
    case .calDAV: return "calDAV"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    default: return "other"
    }
  }

  private static func hex(_ color: NSColor?) -> String {
    guard let c = color?.usingColorSpace(.sRGB) else { return "#8E8E93" }
    return String(format: "#%02X%02X%02X", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)), Int(round(c.blueComponent * 255)))
  }
}
