import ArdiaDesign
import SwiftUI

struct PoofBurst: View {
  struct Spec: Identifiable, Equatable {
    let id = UUID()
    var center: CGPoint
    var size: CGFloat
  }

  struct Puff {
    var angle: Double
    var distance: CGFloat
    var radius: CGFloat
  }

  let spec: Spec
  @State private var progress: CGFloat = 0

  private static let puffs: [Puff] = (0..<9).map { index in
    let angle = Double(index) / 9 * 2 * .pi + (index.isMultiple(of: 2) ? 0.2 : -0.15)
    return Puff(angle: angle, distance: index.isMultiple(of: 3) ? 0.46 : 0.36, radius: index.isMultiple(of: 2) ? 0.2 : 0.15)
  }

  var body: some View {
    ZStack {
      ForEach(Self.puffs.indices, id: \.self) { index in
        let puff = Self.puffs[index]
        let travel = spec.size * puff.distance * (0.35 + 0.65 * progress)
        Circle()
          .fill(TabsPalette.poof)
          .frame(width: spec.size * puff.radius * 2, height: spec.size * puff.radius * 2)
          .scaleEffect(0.45 + 0.75 * progress)
          .offset(x: cos(puff.angle) * travel, y: sin(puff.angle) * travel)
      }
      Circle()
        .fill(TabsPalette.poof)
        .frame(width: spec.size * 0.42, height: spec.size * 0.42)
        .scaleEffect(1 - 0.5 * progress)
    }
    .blur(radius: 2 + 4 * progress)
    .opacity(Double(1 - progress) * 0.95)
    .position(spec.center)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onAppear {
      withAnimation(.easeOut(duration: TabsMotion.poofDuration)) { progress = 1 }
    }
  }
}
