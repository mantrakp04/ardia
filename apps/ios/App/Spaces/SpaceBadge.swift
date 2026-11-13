import ArdiaDesign
import ArdiaSync
import SwiftUI
import UIKit

struct SpaceBadge: View {
  let icon: SyncedIcon
  var size: CGFloat = SidebarMetrics.Row.icon

  var body: some View {
    switch icon {
    case .symbol(let name) where UIImage(systemName: name) != nil:
      Image(systemName: name)
        .font(.system(size: size * 0.8, weight: .semibold))
        .frame(width: size, height: size)
    case .emoji(let text):
      Text(text)
        .font(.system(size: size * 0.85))
        .frame(width: size, height: size)
    case .symbol, .initial:
      Text(letter)
        .font(.system(size: size * 0.6, weight: .bold, design: .rounded))
        .frame(width: size, height: size)
        .background(Tokens.Role.tabSelected, in: .circle)
    }
  }

  private var letter: String {
    switch icon {
    case .initial(let letter): letter
    case .symbol(let name): name.first.map { String($0).uppercased() } ?? "?"
    case .emoji(let text): text
    }
  }
}

struct PinnedMark: View {
  let mark: SyncedIcon?
  let url: String
  var size: CGFloat = SidebarMetrics.Row.icon

  var body: some View {
    switch mark {
    case .symbol(let name) where UIImage(systemName: name) != nil:
      Image(systemName: name)
        .font(.system(size: size * 0.8, weight: .medium))
        .foregroundStyle(.secondary)
        .frame(width: size, height: size)
    case .emoji(let text):
      Text(text)
        .font(.system(size: size * 0.85))
        .frame(width: size, height: size)
    default:
      FaviconImage(iconURL: nil, pageURL: url, size: size)
    }
  }
}
