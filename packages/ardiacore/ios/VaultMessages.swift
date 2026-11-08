import Foundation

enum VaultMessages {
  static let maximumLength = 240

  private static let escapeCodes = #"\x1B\[[0-9;?]*[A-Za-z]"#
  private static let logPrefix = #"^\[[A-Za-z]+\]\s+\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+"#

  static func mentions(_ result: VaultCommandResult, _ needles: [String]) -> Bool {
    let haystack = result.stderr.lowercased()
    return needles.contains { haystack.contains($0.lowercased()) }
  }

  static func failure(_ result: VaultCommandResult, tool: String, redacting secrets: [String] = []) -> String {
    if !result.launched { return "Ardia couldn't start \(tool)." }
    if result.timedOut { return "\(tool) didn't answer in time." }
    if result.cancelled { return "\(tool) was stopped." }
    if result.overflowed { return "\(tool) sent more output than Ardia reads." }
    let line = firstLine(result.stderr, redacting: secrets)
    return line.isEmpty ? "\(tool) stopped with an error (exit \(result.status))." : line
  }

  static func firstLine(_ text: String, redacting secrets: [String] = []) -> String {
    let plain = text.replacingOccurrences(of: escapeCodes, with: "", options: .regularExpression)
    let lines = plain.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
    guard var line = lines.first(where: { !$0.isEmpty }) else { return "" }
    line = line.replacingOccurrences(of: logPrefix, with: "", options: .regularExpression)
    if line.lowercased().hasPrefix("error:") { line = String(line.dropFirst("error:".count)).trimmingCharacters(in: .whitespaces) }
    return redact(line, secrets)
  }

  static func redact(_ text: String, _ secrets: [String]) -> String {
    var cleaned = text
    for secret in secrets where secret.count >= 3 {
      cleaned = cleaned.replacingOccurrences(of: secret, with: "[hidden]")
    }
    return cleaned.count > maximumLength ? String(cleaned.prefix(maximumLength)) + "..." : cleaned
  }
}
