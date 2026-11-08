import Foundation

struct VaultCommandResult: Sendable {
  static let notLaunched = VaultCommandResult(
    status: -1, stdout: Data(), stderr: "", launched: false, timedOut: false, cancelled: false, overflowed: false)

  var status: Int32
  var stdout: Data
  var stderr: String
  var launched: Bool
  var timedOut: Bool
  var cancelled: Bool
  var overflowed: Bool

  var succeeded: Bool { launched && status == 0 && !timedOut && !cancelled && !overflowed }
  var output: String { String(decoding: stdout, as: UTF8.self) }
  var trimmedOutput: String { output.trimmingCharacters(in: .whitespacesAndNewlines) }
}
