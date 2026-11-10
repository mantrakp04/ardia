import AVFoundation
import ArdiaDesign
import SwiftUI
import VisionKit

struct SyncCodeScannerSheet: View {
  var isValid: (String) -> Bool
  var onScan: (String) -> Void
  var onEnterWords: () -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var access: CameraAccess = .checking
  @State private var rejected = 0
  @State private var showsRejection = false

  enum CameraAccess {
    case checking
    case ready
    case denied
    case unsupported
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.black.ignoresSafeArea()
        switch access {
        case .checking:
          ProgressView().tint(.white)
        case .ready:
          SyncCodeCamera { payload in
            if isValid(payload) {
              onScan(payload.trimmingCharacters(in: .whitespacesAndNewlines))
              dismiss()
            } else {
              rejected += 1
              showsRejection = true
            }
          }
          .ignoresSafeArea()
          viewfinder
        case .denied:
          unavailable(
            title: "Allow Camera Access",
            message: "Ardia uses the camera only to read the code your Mac shows. You can allow it in Settings, or type the 24 words instead.",
            showsSettings: true
          )
        case .unsupported:
          unavailable(
            title: "Can’t Scan on This iPhone",
            message: "Type the 24 words of your recovery phrase instead. Your Mac shows them under Connect Another Device.",
            showsSettings: false
          )
        }
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
      }
      .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
      .preferredColorScheme(.dark)
    }
    .task { access = await Self.checkAccess() }
    .sensoryFeedback(.error, trigger: rejected)
  }

  private var viewfinder: some View {
    VStack(spacing: Spacing.medium) {
      VStack(spacing: Spacing.tight) {
        Text("Scan the Code on Your Mac")
          .font(.title3.bold())
        Text("In Ardia on your Mac, open Settings › Sync › Connect Another Device.")
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.75))
          .multilineTextAlignment(.center)
      }
      .padding(.horizontal, Spacing.section)
      .padding(.top, Spacing.page)
      Spacer()
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .strokeBorder(.white.opacity(0.9), style: StrokeStyle(lineWidth: 3, dash: [44, 1000], dashPhase: 22))
        .frame(width: 250, height: 250)
        .accessibilityHidden(true)
      Spacer()
      if showsRejection {
        Text("Not an Ardia sync code.")
          .font(.subheadline.weight(.medium))
          .multilineTextAlignment(.center)
          .padding(.horizontal, Spacing.page)
          .padding(.vertical, Spacing.small)
          .background(.ultraThinMaterial, in: .rect(cornerRadius: Radius.field, style: .continuous))
          .padding(.horizontal, Spacing.section)
          .transition(.opacity)
      }
      Button("Enter Words Instead") {
        dismiss()
        onEnterWords()
      }
      .buttonStyle(.glass)
      .controlSize(.large)
      .padding(.bottom, Spacing.large)
    }
    .foregroundStyle(.white)
    .animation(Motion.snappy, value: showsRejection)
  }

  private func unavailable(title: LocalizedStringKey, message: LocalizedStringKey, showsSettings: Bool) -> some View {
    VStack(spacing: Spacing.medium) {
      Image(systemName: showsSettings ? "camera.fill" : "qrcode.viewfinder")
        .font(.system(size: 48, weight: .regular))
        .foregroundStyle(.white.opacity(0.85))
        .accessibilityHidden(true)
      VStack(spacing: Spacing.tight) {
        Text(title).font(.title3.bold())
        Text(message)
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.75))
          .multilineTextAlignment(.center)
      }
      VStack(spacing: Spacing.small) {
        if showsSettings {
          Button("Open Settings") {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
          }
          .buttonStyle(.glassProminent)
          .tint(Palette.indigo)
        }
        Button("Enter Words Instead") {
          dismiss()
          onEnterWords()
        }
        .buttonStyle(.glass)
      }
      .controlSize(.large)
      .padding(.top, Spacing.tight)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, Spacing.section)
  }

  static func checkAccess() async -> CameraAccess {
    guard DataScannerViewController.isSupported else { return .unsupported }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      return DataScannerViewController.isAvailable ? .ready : .unsupported
    case .notDetermined:
      let granted = await AVCaptureDevice.requestAccess(for: .video)
      return granted ? .ready : .denied
    default:
      return .denied
    }
  }
}

private struct SyncCodeCamera: UIViewControllerRepresentable {
  var onPayload: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onPayload: onPayload)
  }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isPinchToZoomEnabled: true,
      isGuidanceEnabled: false,
      isHighlightingEnabled: true
    )
    scanner.delegate = context.coordinator
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
    context.coordinator.onPayload = onPayload
    if !scanner.isScanning { try? scanner.startScanning() }
  }

  static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
    scanner.stopScanning()
  }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    var onPayload: (String) -> Void
    private var lastPayload: String?

    init(onPayload: @escaping (String) -> Void) {
      self.onPayload = onPayload
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
      for item in addedItems {
        guard case .barcode(let barcode) = item, let payload = barcode.payloadStringValue, payload != lastPayload else { continue }
        lastPayload = payload
        onPayload(payload)
        return
      }
    }
  }
}
