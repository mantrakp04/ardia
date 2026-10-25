import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct ClearBrowsingDataPage: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var range: ClearRange = .today
  @State private var clearsHistory = true
  @State private var clearsCache = true
  @State private var clearsCookies = false
  @State private var clearsArchive = false
  @State private var isConfirming = false
  @State private var isClearing = false
  @State private var clearTicks = 0

  var body: some View {
    let choice = ClearChoice(history: clearsHistory, cache: clearsCache, cookies: clearsCookies, archive: clearsArchive && range == .allTime)
    Form {
      Section {
        Picker("Time Range", selection: $range) {
          ForEach(ClearRange.allCases) { range in
            Text(range.title).tag(range)
          }
        }
        .tint(.secondary)
      }

      Section {
        Toggle("History", isOn: $clearsHistory)
        Toggle("Cache", isOn: $clearsCache)
        Toggle("Cookies and Site Data", isOn: $clearsCookies)
        if range == .allTime {
          Toggle("Archived Tabs", isOn: $clearsArchive)
        }
      } header: {
        Text("Clear")
      } footer: {
        Text(choice.footer)
          .contentTransition(.opacity)
      }

      Section {
        Button(role: .destructive) {
          isConfirming = true
        } label: {
          HStack {
            Text("Clear Data…")
            Spacer()
            if isClearing { ProgressView() }
          }
        }
        .disabled(choice.isEmpty || isClearing)
      }
    }
    .navigationTitle("Clear Browsing Data")
    .navigationBarTitleDisplayMode(.inline)
    .animation(Motion.snappy, value: range)
    .confirmationDialog(choice.confirmationTitle(range), isPresented: $isConfirming, titleVisibility: .visible) {
      Button("Clear Data", role: .destructive) {
        clearTicks += 1
        clear(choice)
      }
    } message: {
      Text(choice.confirmationMessage)
    }
    .sensoryFeedback(.warning, trigger: clearTicks)
  }

  private func clear(_ choice: ClearChoice) {
    isClearing = true
    Task {
      await BrowsingDataCleaner.clear(choice.kinds, since: range.since(now: .now), tabs: app.tabs)
      if choice.archive { app.tabs.clearArchive() }
      isClearing = false
      app.toasts.show(.clearedBrowsingData)
      dismiss()
    }
  }
}

enum ClearRange: String, CaseIterable, Identifiable {
  case lastHour
  case today
  case todayAndYesterday
  case allTime

  var id: String { rawValue }

  var title: String {
    switch self {
    case .lastHour: String(localized: "Last Hour")
    case .today: String(localized: "Today")
    case .todayAndYesterday: String(localized: "Today and Yesterday")
    case .allTime: String(localized: "All Time")
    }
  }

  var phrase: String {
    switch self {
    case .lastHour: String(localized: "from the last hour")
    case .today: String(localized: "from today")
    case .todayAndYesterday: String(localized: "from today and yesterday")
    case .allTime: String(localized: "from all time")
    }
  }

  func since(now: Date, calendar: Calendar = .current) -> Date? {
    switch self {
    case .lastHour: now.addingTimeInterval(-3600)
    case .today: calendar.startOfDay(for: now)
    case .todayAndYesterday: calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now))
    case .allTime: nil
    }
  }
}

struct ClearChoice: Equatable {
  var history: Bool
  var cache: Bool
  var cookies: Bool
  var archive: Bool

  var kinds: Set<BrowsingDataKind> {
    var kinds: Set<BrowsingDataKind> = []
    if history { kinds.insert(.history) }
    if cache { kinds.insert(.cache) }
    if cookies { kinds.insert(.cookiesAndSiteData) }
    return kinds
  }

  var isEmpty: Bool { kinds.isEmpty && !archive }

  private var names: [String] {
    var names: [String] = []
    if history { names.append(String(localized: "History")) }
    if cache { names.append(String(localized: "Cache")) }
    if cookies { names.append(String(localized: "Cookies")) }
    if archive { names.append(String(localized: "Archived Tabs")) }
    return names
  }

  func confirmationTitle(_ range: ClearRange) -> String {
    let list = names.formatted(.list(type: .and))
    return String(localized: "Clear \(list) \(range.phrase)?")
  }

  var confirmationMessage: String {
    cookies
      ? String(localized: "You’ll be signed out of websites. Open tabs stay open.")
      : String(localized: "Open tabs stay open, and you stay signed in to websites.")
  }

  var footer: String {
    if isEmpty { return String(localized: "Choose what to clear.") }
    var lines: [String] = []
    if history { lines.append(String(localized: "History clears from this iPhone. Your Mac’s history stays on your Mac.")) }
    if cookies { lines.append(String(localized: "Clearing cookies signs you out of websites.")) }
    if !cookies { lines.append(String(localized: "You’ll stay signed in to websites.")) }
    return lines.joined(separator: " ")
  }
}

#Preview("Clear Browsing Data") {
  NavigationStack {
    ClearBrowsingDataPage()
  }
  .environment(AppModel(isDemo: true))
}
