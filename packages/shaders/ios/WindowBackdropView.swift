import ArdiaCore
import ExpoModulesCore
import MetalKit

final class WindowBackdropView: MetalSurface {
  struct Uniforms {
    var labA = SIMD4<Float>(0.27, 0.02, 0.0, 1)
    var labB = SIMD4<Float>(0.23, 0.02, 0.0, 1)
    var viewSize = SIMD2<Float>(0, 0)
    var direction = SIMD2<Float>(0, 1)
    var grainOpacity: Float = 0.1
    var grainScale: Float = 1
    var pad = SIMD2<Float>(0, 0)
  }

  private var uniforms = Uniforms()
  private var treatment: WindowTreatmentView?
  private var tint = WindowTreatmentView.Tint()
  private var custom = ThemeGradient()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.isPaused = true
    metalView.enableSetNeedsDisplay = true
  }

  func setColors(_ hex: [String]) {
    let rgba = hex.compactMap { RGBA(hex: $0)?.simd }
    guard let first = rgba.first else { return }
    uniforms.labA = Self.oklab(first)
    uniforms.labB = Self.oklab(rgba.last ?? first)
    metalView.needsDisplay = true
  }

  func setVibrancy(_ on: Bool) {
    guard on != (treatment != nil) else { return }
    if on {
      let view = WindowTreatmentView(frame: bounds)
      view.tint = tint
      view.custom = custom.isEmpty ? nil : custom
      addSubview(view, positioned: .below, relativeTo: metalView)
      treatment = view
    } else {
      treatment?.removeFromSuperview()
      treatment = nil
    }
    if on {
      metalView.isHidden = true
      metalView.autoResizeDrawable = false
      metalView.drawableSize = CGSize(width: 1, height: 1)
    } else {
      revealAtFullSize()
    }
  }

  private func revealAtFullSize() {
    metalView.drawableSize = convertToBacking(bounds).size
    metalView.autoResizeDrawable = true
    let layer = metalView.layer as? CAMetalLayer
    layer?.presentsWithTransaction = true
    metalView.draw()
    layer?.presentsWithTransaction = false
    metalView.isHidden = false
  }

  func setTint(_ update: (inout WindowTreatmentView.Tint) -> Void) {
    update(&tint)
    treatment?.tint = tint
  }

  func setCustom(_ update: (inout ThemeGradient) -> Void) {
    update(&custom)
    treatment?.custom = custom.isEmpty ? nil : custom
  }

  func setAngle(_ degrees: Double) {
    let r = Float(degrees) * .pi / 180
    uniforms.direction = SIMD2(sin(r), -cos(r))
    metalView.needsDisplay = true
  }

  func set(_ key: WritableKeyPath<Uniforms, Float>, _ value: Float) {
    uniforms[keyPath: key] = value
    metalView.needsDisplay = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    treatment?.frame = bounds
    if treatment == nil { metalView.needsDisplay = true }
  }

  override class var fragmentName: String { "backdropFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    uniforms.viewSize = size
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
  }

  static func oklab(_ c: SIMD4<Float>) -> SIMD4<Float> {
    func lin(_ x: Float) -> Float { x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
    let r = lin(c.x), g = lin(c.y), b = lin(c.z)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return SIMD4(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
      c.w)
  }

  override class var shaderSource: String { backdropSource }
}

let backdropSource = """
struct BackdropUniforms {
  float4 labA;
  float4 labB;
  float2 viewSize;
  float2 direction;
  float grainOpacity;
  float grainScale;
  float2 pad;
};

static float3 oklabToSRGB(float3 lab) {
  float3 lms = float3(dot(lab, float3(1.0f, 0.3963377774f, 0.2158037573f)),
                      dot(lab, float3(1.0f, -0.1055613458f, -0.0638541728f)),
                      dot(lab, float3(1.0f, -0.0894841775f, -1.2914855480f)));
  lms = lms * lms * lms;
  float3 lin = float3(dot(lms, float3(4.0767416621f, -3.3077115913f, 0.2309699292f)),
                      dot(lms, float3(-1.2684380046f, 2.6097574011f, -0.3413193965f)),
                      dot(lms, float3(-0.0041960863f, -0.7034186147f, 1.7076147010f)));
  float3 a = abs(lin);
  float3 encoded = sign(lin) * (1.055f * pow(a, 1.0f / 2.4f) - 0.055f);
  return select(encoded, lin * 12.92f, a <= 0.0031308f);
}

static inline float grainHash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031f);
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.x + p3.y) * p3.z);
}

fragment float4 backdropFragment(FullscreenOut in [[stage_in]],
                                 constant BackdropUniforms &u [[buffer(0)]]) {
  float t = saturate(dot(in.uv - 0.5f, u.direction) + 0.5f);
  float4 lab = mix(u.labA, u.labB, t);
  float3 base = oklabToSRGB(lab.xyz);

  float2 cell = floor(in.uv * u.viewSize / max(u.grainScale, 0.25f));
  float g = grainHash(cell);
  float3 rgb = base * (1.0f - u.grainOpacity * (1.0f - g));
  return float4(saturate(rgb), lab.w);
}
"""
