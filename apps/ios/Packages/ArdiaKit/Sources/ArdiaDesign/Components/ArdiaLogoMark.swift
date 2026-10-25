import SwiftUI

public struct ArdiaLogoMark: View {
  public var outline: Bool

  public init(outline: Bool = true) {
    self.outline = outline
  }

  public var body: some View {
    Canvas { context, size in
      let width = outline ? size.width * 0.075 : 0
      let shapes = LogoGeometry.shapes(in: CGRect(origin: .zero, size: size).insetBy(dx: width / 2 + 1, dy: width / 2 + 1))
      if outline {
        let style = StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
        for shape in shapes {
          context.stroke(shape.path, with: .color(.white), style: style)
          context.fill(shape.path, with: .color(.white))
        }
      }
      for shape in shapes {
        context.fill(shape.path, with: .linearGradient(
          Gradient(colors: [shape.top, shape.bottom]),
          startPoint: CGPoint(x: shape.path.boundingRect.midX, y: shape.path.boundingRect.minY),
          endPoint: CGPoint(x: shape.path.boundingRect.midX, y: shape.path.boundingRect.maxY)
        ))
      }
    }
    .aspectRatio(LogoGeometry.aspectRatio, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

enum LogoGeometry {
  struct Shape {
    var path: Path
    var top: Color
    var bottom: Color
  }

  static let canvas = CGRect(x: 26, y: 186, width: 972, height: 772)
  static var aspectRatio: CGFloat { canvas.width / canvas.height }

  static func shapes(in rect: CGRect) -> [Shape] {
    let scale = min(rect.width / canvas.width, rect.height / canvas.height)
    let transform = CGAffineTransform(translationX: rect.minX, y: rect.minY)
      .scaledBy(x: scale, y: scale)
      .translatedBy(x: -canvas.minX, y: -canvas.minY)
    return [
      Shape(path: sun.applying(transform), top: Color(hex: 0xFFCB45), bottom: Color(hex: 0xF5A812)),
      Shape(path: backHill.applying(transform), top: Color(hex: 0x8DAF63), bottom: Color(hex: 0x5E7D3E)),
      Shape(path: frontHill.applying(transform), top: Color(hex: 0x17604B), bottom: Color(hex: 0x063528)),
    ]
  }

  static let sun = Path(ellipseIn: CGRect(x: 432, y: 192, width: 248, height: 248))

  static let backHill: Path = {
    var path = Path()
    path.move(to: CGPoint(x: 66, y: 828))
    path.addCurve(to: CGPoint(x: 150, y: 430), control1: CGPoint(x: 22, y: 700), control2: CGPoint(x: 40, y: 520))
    path.addCurve(to: CGPoint(x: 372, y: 388), control1: CGPoint(x: 210, y: 375), control2: CGPoint(x: 300, y: 352))
    path.addCurve(to: CGPoint(x: 610, y: 548), control1: CGPoint(x: 460, y: 425), control2: CGPoint(x: 530, y: 486))
    path.addLine(to: CGPoint(x: 640, y: 780))
    path.addLine(to: CGPoint(x: 300, y: 820))
    path.closeSubpath()
    return path
  }()

  static let frontHill: Path = {
    var path = Path()
    path.move(to: CGPoint(x: 68, y: 834))
    path.addCurve(to: CGPoint(x: 690, y: 466), control1: CGPoint(x: 250, y: 700), control2: CGPoint(x: 500, y: 556))
    path.addCurve(to: CGPoint(x: 935, y: 482), control1: CGPoint(x: 770, y: 432), control2: CGPoint(x: 868, y: 424))
    path.addCurve(to: CGPoint(x: 978, y: 820), control1: CGPoint(x: 1004, y: 545), control2: CGPoint(x: 1000, y: 705))
    path.addCurve(to: CGPoint(x: 842, y: 952), control1: CGPoint(x: 962, y: 902), control2: CGPoint(x: 922, y: 952))
    path.addLine(to: CGPoint(x: 204, y: 952))
    path.addCurve(to: CGPoint(x: 68, y: 834), control1: CGPoint(x: 124, y: 950), control2: CGPoint(x: 70, y: 904))
    path.closeSubpath()
    return path
  }()
}

public struct FidgetLogo: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var angle: Angle = .zero
  @State private var dragStart: Angle?
  @State private var lastSample: (angle: Angle, time: Date)?
  @State private var velocity: Double = 0
  @State private var spins = 0

  public init() {}

  public var body: some View {
    GeometryReader { proxy in
      let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
      ArdiaLogoMark()
        .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        .rotationEffect(angle)
        .frame(width: proxy.size.width, height: proxy.size.height)
        .contentShape(.circle)
        .gesture(spin(around: center))
    }
    .sensoryFeedback(.impact(weight: .light), trigger: spins)
    .accessibilityElement()
    .accessibilityLabel("Ardia")
    .accessibilityAddTraits(.isImage)
  }

  private func spin(around center: CGPoint) -> some Gesture {
    DragGesture(minimumDistance: 2)
      .onChanged { value in
        let start = Self.bearing(of: value.startLocation, around: center)
        let now = Self.bearing(of: value.location, around: center)
        if dragStart == nil { dragStart = angle }
        var delta = now - start
        if delta.degrees > 180 { delta -= .degrees(360) }
        if delta.degrees < -180 { delta += .degrees(360) }
        let target = (dragStart ?? .zero) + delta
        let time = value.time
        if let lastSample {
          let elapsed = time.timeIntervalSince(lastSample.time)
          if elapsed > 0.004 { velocity = (target.degrees - lastSample.angle.degrees) / elapsed }
        }
        lastSample = (target, time)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { angle = target }
      }
      .onEnded { _ in
        dragStart = nil
        lastSample = nil
        let clamped = max(-2400, min(2400, velocity))
        velocity = 0
        guard abs(clamped) > 60 else { return }
        spins += 1
        if reduceMotion {
          withAnimation(.easeOut(duration: 0.3)) { angle = .zero }
          return
        }
        let travel = clamped * 0.42
        withAnimation(.timingCurve(0.12, 0.7, 0.25, 1, duration: Motion.logoSpinDecay)) {
          angle += .degrees(travel)
        }
      }
  }

  private static func bearing(of point: CGPoint, around center: CGPoint) -> Angle {
    .radians(atan2(point.y - center.y, point.x - center.x))
  }
}

#Preview("Logo") {
  VStack(spacing: 32) {
    ArdiaLogoMark().frame(width: 140)
    ArdiaLogoMark(outline: false).frame(width: 140)
    FidgetLogo().frame(width: 140, height: 120)
  }
  .padding(40)
  .background(LaunchGradient())
}
