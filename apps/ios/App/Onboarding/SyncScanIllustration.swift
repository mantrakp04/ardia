import ArdiaDesign
import CoreImage
import SwiftUI

struct SyncScanIllustration: View {
  var connected: Bool

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      MacWindowSketch()
        .frame(width: 250, height: 168)
        .padding(.trailing, 46)
        .padding(.bottom, 40)
      PhoneSketch(connected: connected)
        .frame(width: 92, height: 186)
    }
    .accessibilityHidden(true)
  }
}

private struct MacWindowSketch: View {
  var body: some View {
    HStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 7) {
        HStack(spacing: 4) {
          Circle().fill(Color(hex: 0xFF5F57)).frame(width: 7, height: 7)
          Circle().fill(Color(hex: 0xFEBC2E)).frame(width: 7, height: 7)
          Circle().fill(Color(hex: 0x28C840)).frame(width: 7, height: 7)
        }
        .padding(.bottom, 4)
        ForEach(Array(SketchTab.all.enumerated()), id: \.offset) { _, tab in
          HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2.5).fill(tab.color).frame(width: 9, height: 9)
            Capsule().fill(Color.primary.opacity(0.18)).frame(width: tab.width, height: 5)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(10)
      .frame(width: 84, alignment: .leading)
      .frame(maxHeight: .infinity, alignment: .top)
      .background(LaunchGradient(softened: true).opacity(0.9))

      ZStack {
        Color(.systemBackground)
        VStack(spacing: 8) {
          SketchQRCode()
            .frame(width: 74, height: 74)
          Capsule().fill(Color.primary.opacity(0.14)).frame(width: 90, height: 5)
          Capsule().fill(Color.primary.opacity(0.1)).frame(width: 64, height: 5)
        }
      }
    }
    .clipShape(.rect(cornerRadius: 12, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
    }
    .shadow(color: Palette.gradientDeep.opacity(0.18), radius: 18, y: 8)
  }
}

private struct PhoneSketch: View {
  var connected: Bool

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .fill(Color(white: 0.08))
      ZStack {
        if connected {
          LaunchGradient()
        } else {
          Color(white: 0.22)
        }
      }
      .clipShape(.rect(cornerRadius: 18, style: .continuous))
      .padding(4)
      if connected {
        Image(systemName: "checkmark")
          .font(.system(size: 30, weight: .bold))
          .foregroundStyle(.white)
          .transition(.scale.combined(with: .opacity))
      } else {
        ViewfinderCorners()
          .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
          .frame(width: 58, height: 58)
          .overlay { SketchQRCode().frame(width: 40, height: 40).opacity(0.85) }
      }
      Capsule().fill(.black).frame(width: 28, height: 8).frame(maxHeight: .infinity, alignment: .top).padding(.top, 10)
    }
    .shadow(color: .black.opacity(0.25), radius: 14, y: 8)
  }
}

nonisolated private struct ViewfinderCorners: Shape {
  func path(in rect: CGRect) -> Path {
    let arm = rect.width * 0.28
    var path = Path()
    for (corner, dx, dy) in [(CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0), (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0), (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0), (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0)] {
      path.move(to: CGPoint(x: corner.x, y: corner.y + dy * arm))
      path.addLine(to: corner)
      path.addLine(to: CGPoint(x: corner.x + dx * arm, y: corner.y))
    }
    return path
  }
}

private struct SketchQRCode: View {
  var body: some View {
    if let image = SketchQR.image {
      Image(decorative: image, scale: 1)
        .resizable()
        .interpolation(.none)
    }
  }
}

private enum SketchQR {
  static let image: CGImage? = {
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
    filter.setValue(Data("https://ardia.dev".utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else { return nil }
    return CIContext(options: [.useSoftwareRenderer: true]).createCGImage(output, from: output.extent)
  }()
}

private struct SketchTab {
  var color: Color
  var width: CGFloat

  static let all: [SketchTab] = [
    SketchTab(color: Palette.indigo, width: 44),
    SketchTab(color: Palette.gradientPink, width: 36),
    SketchTab(color: Color(hex: 0xFF9F0A), width: 48),
    SketchTab(color: Color(hex: 0x34C759), width: 30),
    SketchTab(color: Palette.gradientPlum, width: 40),
  ]
}

#Preview("Sync Illustration") {
  VStack(spacing: 40) {
    SyncScanIllustration(connected: false)
    SyncScanIllustration(connected: true)
  }
}
