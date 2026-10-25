import ImageIO
import SwiftUI
import WidgetKit

public enum SystemWidgetSize: Sendable {
  case small
  case medium
  case large
}

public enum SystemPalette {
  public static let widgetAccent = Color.adaptive(light: Color(hex: 0x3139FB), dark: Color(hex: 0x6F86FF))
  public static let capsuleOnGradient = Color.white.opacity(0.2)
  public static let capsuleStrokeOnGradient = Color.white.opacity(0.28)
  public static let capsulePlain = Color.adaptive(light: Color(hex: 0x3139FB, opacity: 0.09), dark: .white.opacity(0.12))
  public static let rowPressed = Color.adaptive(light: .black.opacity(0.05), dark: .white.opacity(0.08))
}

public enum SystemWidgetLayout {
  public static let capsuleHeight: CGFloat = 44
  public static let roundButton: CGFloat = 44
  public static let markSmall = CGSize(width: 46, height: 37)
  public static let rowFavicon: CGFloat = 22
  public static let rowSpacing: CGFloat = 10
  public static let largestType = DynamicTypeSize.xxLarge
}

public struct SearchWidgetContent: View {
  public var size: SystemWidgetSize
  public var showsBackground: Bool
  public var offersBrowseForMe: Bool

  @Environment(\.widgetRenderingMode) private var renderingMode

  public init(size: SystemWidgetSize, showsBackground: Bool, offersBrowseForMe: Bool) {
    self.size = size
    self.showsBackground = showsBackground
    self.offersBrowseForMe = offersBrowseForMe
  }

  private var onGradient: Bool { showsBackground && renderingMode == .fullColor }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        ArdiaLogoMark()
          .frame(width: SystemWidgetLayout.markSmall.width, height: SystemWidgetLayout.markSmall.height)
          .shadow(color: .black.opacity(onGradient ? 0.2 : 0.08), radius: 6, y: 3)
        Spacer(minLength: 0)
        if size != .small {
          Text("Ardia")
            .font(.system(.subheadline, design: .rounded, weight: .bold))
            .foregroundStyle(onGradient ? AnyShapeStyle(.white.opacity(0.85)) : AnyShapeStyle(SystemPalette.widgetAccent))
            .widgetAccentable()
        }
      }
      Spacer(minLength: Spacing.tight)
      HStack(spacing: Spacing.tight) {
        Link(destination: SystemLink.search(query: nil, browseForMe: false).url) {
          searchCapsule
        }
        if size != .small {
          if offersBrowseForMe {
            Link(destination: SystemLink.search(query: nil, browseForMe: true).url) {
              roundButton(symbol: "sparkle.magnifyingglass", label: "Browse for Me")
            }
          }
          Link(destination: SystemLink.voiceSearch.url) {
            roundButton(symbol: "mic.fill", label: "Voice Search")
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .dynamicTypeSize(...SystemWidgetLayout.largestType)
  }

  private var searchCapsule: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 15, weight: .bold))
      Text(size == .small ? "Search" : "Search or Enter Address")
        .font(.system(size: 15, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Spacer(minLength: 0)
    }
    .foregroundStyle(onGradient ? AnyShapeStyle(.white) : AnyShapeStyle(SystemPalette.widgetAccent))
    .padding(.horizontal, 14)
    .frame(height: SystemWidgetLayout.capsuleHeight)
    .frame(maxWidth: .infinity)
    .background(capsuleFill, in: .capsule)
    .overlay {
      if onGradient { Capsule().strokeBorder(SystemPalette.capsuleStrokeOnGradient, lineWidth: 0.5) }
    }
    .widgetAccentable()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Search")
  }

  private func roundButton(symbol: String, label: LocalizedStringKey) -> some View {
    Image(systemName: symbol)
      .font(.system(size: 17, weight: .semibold))
      .foregroundStyle(onGradient ? AnyShapeStyle(.white) : AnyShapeStyle(SystemPalette.widgetAccent))
      .frame(width: SystemWidgetLayout.roundButton, height: SystemWidgetLayout.roundButton)
      .background(capsuleFill, in: .circle)
      .overlay {
        if onGradient { Circle().strokeBorder(SystemPalette.capsuleStrokeOnGradient, lineWidth: 0.5) }
      }
      .widgetAccentable()
      .accessibilityLabel(Text(label))
  }

  private var capsuleFill: some ShapeStyle {
    onGradient ? AnyShapeStyle(SystemPalette.capsuleOnGradient) : AnyShapeStyle(SystemPalette.capsulePlain)
  }
}

public struct SearchWidgetBackground: View {
  public var showsBackground: Bool
  public var colors: [Color]

  public init(showsBackground: Bool, colors: [Color] = Palette.launchGradient) {
    self.showsBackground = showsBackground
    self.colors = colors
  }

  public var body: some View {
    if showsBackground {
      LaunchGradient(colors: colors)
    } else {
      Color.adaptive(light: .white, dark: Color(hex: 0x1C1C1E))
    }
  }
}

public struct MacTabsWidgetContent: View {
  public var snapshot: SystemSnapshot
  public var size: SystemWidgetSize
  public var store: SystemStore?

  @Environment(\.dynamicTypeSize) private var typeSize

  public init(snapshot: SystemSnapshot, size: SystemWidgetSize, store: SystemStore?) {
    self.snapshot = snapshot
    self.size = size
    self.store = store
  }

  private var rowLimit: Int {
    let roomy = typeSize <= .large
    return size == .large ? (roomy ? 7 : 6) : (roomy ? 3 : 2)
  }

  public var body: some View {
    rows.dynamicTypeSize(...SystemWidgetLayout.largestType)
  }

  @ViewBuilder
  private var rows: some View {
    if !snapshot.isSyncEnabled {
      MacTabsEmptyView(
        title: "Sync With Your Mac",
        message: "See the tabs you have open in Ardia on your Mac.",
        symbol: "laptopcomputer.and.iphone",
        size: size
      )
      .widgetURL(SystemLink.macTabs.url)
    } else if snapshot.macTabs.allSatisfy(\.tabs.isEmpty) {
      MacTabsEmptyView(
        title: "No Tabs Open on Your Mac",
        message: "Tabs you open in Ardia on your Mac show up here.",
        symbol: "laptopcomputer",
        size: size
      )
      .widgetURL(SystemLink.macTabs.url)
    } else {
      VStack(alignment: .leading, spacing: SystemWidgetLayout.rowSpacing) {
        ForEach(sections, id: \.device.id) { section in
          header(for: section.device)
          ForEach(section.tabs) { tab in
            Link(destination: link(for: tab)) {
              MacTabRow(tab: tab, store: store)
            }
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private var sections: [SystemDeviceTabs] {
    var remaining = rowLimit
    var result: [SystemDeviceTabs] = []
    for group in snapshot.macTabs where !group.tabs.isEmpty {
      guard remaining > (result.isEmpty ? 0 : 1) else { break }
      if !result.isEmpty { remaining -= 1 }
      let tabs = Array(group.tabs.prefix(remaining))
      remaining -= tabs.count
      result.append(SystemDeviceTabs(device: group.device, tabs: tabs))
      if size != .large { break }
    }
    return result
  }

  private func link(for tab: SystemTab) -> URL {
    URL(string: tab.url).map { SystemLink.open($0).url } ?? SystemLink.macTabs.url
  }

  private func header(for device: SystemDevice) -> some View {
    Link(destination: SystemLink.macTabs.url) {
      HStack(spacing: 5) {
        Image(systemName: device.symbol)
          .font(.caption.weight(.semibold))
        Text(device.name)
          .font(.caption.weight(.semibold))
          .lineLimit(1)
        Spacer(minLength: 0)
        ArdiaLogoMark(outline: false)
          .frame(width: 18, height: 14)
      }
      .foregroundStyle(SystemPalette.widgetAccent)
      .widgetAccentable()
    }
  }
}

struct MacTabRow: View {
  let tab: SystemTab
  let store: SystemStore?

  var body: some View {
    HStack(spacing: 10) {
      SystemFavicon(name: tab.favicon, host: tab.host, store: store)
        .frame(width: SystemWidgetLayout.rowFavicon, height: SystemWidgetLayout.rowFavicon)
      VStack(alignment: .leading, spacing: 0) {
        Text(tab.displayTitle)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(BrowsePalette.foregroundPrimary)
          .lineLimit(1)
        if let host = tab.host {
          Text(host)
            .font(.caption2)
            .foregroundStyle(BrowsePalette.foregroundSecondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
    }
    .contentShape(.rect)
  }
}

struct MacTabsEmptyView: View {
  let title: LocalizedStringKey
  let message: LocalizedStringKey
  let symbol: String
  let size: SystemWidgetSize

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .top) {
        Image(systemName: symbol)
          .font(.title2.weight(.semibold))
          .foregroundStyle(SystemPalette.widgetAccent)
          .widgetAccentable()
        Spacer(minLength: 0)
        ArdiaLogoMark()
          .frame(width: 32, height: 26)
      }
      Spacer(minLength: 0)
      Text(title)
        .font(.headline)
        .foregroundStyle(BrowsePalette.foregroundPrimary)
      Text(message)
        .font(.subheadline)
        .foregroundStyle(BrowsePalette.foregroundSecondary)
        .lineLimit(size == .large ? 4 : 2)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct SystemFavicon: View {
  let name: String?
  let host: String?
  let store: SystemStore?

  var body: some View {
    Group {
      if let image {
        Image(decorative: image, scale: 1)
          .resizable()
          .interpolation(.high)
          .widgetAccentedRenderingMode(.desaturated)
          .scaledToFit()
          .padding(1.5)
          .background(.white)
      } else {
        ZStack {
          Rectangle().fill(.fill.secondary)
          Text(host?.first.map { String($0).uppercased() } ?? "")
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
        }
      }
    }
    .clipShape(.rect(cornerRadius: 5, style: .continuous))
  }

  private var image: CGImage? {
    guard let name, let store else { return nil }
    let url = store.faviconURL(named: name) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }
}

public struct SearchLockScreenCircular: View {
  public var isVoice: Bool

  public init(isVoice: Bool) {
    self.isVoice = isVoice
  }

  public var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      Image(systemName: isVoice ? "mic.fill" : "magnifyingglass")
        .font(.system(size: 24, weight: .semibold))
    }
    .widgetURL(isVoice ? SystemLink.voiceSearch.url : SystemLink.search(query: nil, browseForMe: false).url)
    .accessibilityLabel(isVoice ? Text("Voice Search") : Text("Search"))
  }
}

public struct SearchLockScreenRectangular: View {
  public var offersBrowseForMe: Bool

  public init(offersBrowseForMe: Bool) {
    self.offersBrowseForMe = offersBrowseForMe
  }

  public var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 20, weight: .semibold))
        .frame(width: 38, height: 38)
        .background(.fill.secondary, in: .circle)
      VStack(alignment: .leading, spacing: 0) {
        Text("Ardia")
          .font(.headline)
          .widgetAccentable()
        Text(offersBrowseForMe ? "Search or Browse for Me" : "Search the Web")
          .font(.caption)
          .lineLimit(2)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
    .widgetURL(SystemLink.search(query: nil, browseForMe: false).url)
  }
}

public struct SearchLockScreenInline: View {
  public init() {}

  public var body: some View {
    Label("Search with Ardia", systemImage: "magnifyingglass")
      .widgetURL(SystemLink.search(query: nil, browseForMe: false).url)
  }
}

public extension SystemSnapshot {
  static let preview = SystemSnapshot(
    isSyncEnabled: true,
    macTabs: [
      SystemDeviceTabs(
        device: SystemDevice(id: "mac-1", name: "Luke’s MacBook Pro", kind: .mac),
        tabs: [
          SystemTab(title: "Swift.org - Welcome to Swift", url: "https://www.swift.org/"),
          SystemTab(title: "Lisbon - Wikipedia", url: "https://en.wikipedia.org/wiki/Lisbon"),
          SystemTab(title: "Arts - The New York Times", url: "https://www.nytimes.com/section/arts"),
          SystemTab(title: "WWDC Sessions - Apple Developer", url: "https://developer.apple.com/videos/"),
          SystemTab(title: "", url: "https://news.ycombinator.com/"),
        ]
      ),
      SystemDeviceTabs(
        device: SystemDevice(id: "mac-2", name: "iMac", kind: .mac),
        tabs: [
          SystemTab(title: "Figma", url: "https://www.figma.com/files"),
          SystemTab(title: "A very long page title that keeps going well past the edge of the widget row", url: "https://example.com/long"),
        ]
      ),
    ],
    sendTargets: [SystemDevice(id: "mac-1", name: "Luke’s MacBook Pro", kind: .mac)],
    isBrowseForMeAvailable: true
  )
}
