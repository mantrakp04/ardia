import SwiftUI

public struct IncognitoEyes: View {
  public var isOpen: Bool

  public init(isOpen: Bool = true) {
    self.isOpen = isOpen
  }

  public var body: some View {
    Canvas { context, size in
      let eyeWidth = size.width * 0.44
      let gap = size.width - eyeWidth * 2
      for index in 0..<2 {
        let x = CGFloat(index) * (eyeWidth + gap)
        let eye = CGRect(x: x, y: 0, width: eyeWidth, height: size.height)
        context.fill(Path(ellipseIn: eye), with: .foreground)
        guard isOpen else { continue }
        let pupilSize = CGSize(width: eyeWidth * 0.46, height: size.height * 0.4)
        let pupil = CGRect(
          x: eye.midX - pupilSize.width / 2 + eyeWidth * 0.08,
          y: eye.midY - pupilSize.height / 2 + size.height * 0.08,
          width: pupilSize.width,
          height: pupilSize.height
        )
        context.blendMode = .destinationOut
        context.fill(Path(ellipseIn: pupil), with: .color(.black))
        context.blendMode = .normal
      }
    }
    .compositingGroup()
    .aspectRatio(1.3, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

public struct LittleSmile: View {
  public var openness: CGFloat

  public init(openness: CGFloat = 0.5) {
    self.openness = openness
  }

  public var body: some View {
    Canvas { context, size in
      let eyeHeight = size.height * 0.26
      let eyeWidth = size.width * 0.075
      for x in [size.width * 0.34, size.width * 0.66] {
        let eye = CGRect(x: x - eyeWidth / 2, y: size.height * 0.22, width: eyeWidth, height: eyeHeight)
        context.fill(Path(roundedRect: eye, cornerRadius: eyeWidth / 2), with: .foreground)
      }
      var smile = Path()
      let top = size.height * 0.62
      let depth = size.height * (0.08 + 0.2 * openness)
      smile.move(to: CGPoint(x: size.width * 0.26, y: top))
      smile.addQuadCurve(to: CGPoint(x: size.width * 0.74, y: top), control: CGPoint(x: size.width / 2, y: top + depth * 2))
      context.stroke(smile, with: .foreground, style: StrokeStyle(lineWidth: size.width * 0.075, lineCap: .round))
    }
    .aspectRatio(1, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

#Preview("Glyphs") {
  HStack(spacing: 24) {
    IncognitoEyes().frame(width: 26).foregroundStyle(.secondary)
    IncognitoEyes(isOpen: false).frame(width: 26).foregroundStyle(.secondary)
    LittleSmile(openness: 1).frame(width: 80).foregroundStyle(.white)
      .padding()
      .background(Palette.indigo, in: .circle)
  }
  .padding()
}
