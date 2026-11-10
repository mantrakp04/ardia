import CoreGraphics
import Vision

enum VaultQRDecoder {
  static func payloads(in image: CGImage) -> [String] {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return []
    }
    return (request.results ?? []).compactMap { $0.payloadStringValue }
  }
}
