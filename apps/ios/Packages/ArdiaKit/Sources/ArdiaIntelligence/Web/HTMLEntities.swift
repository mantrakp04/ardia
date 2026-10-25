import Foundation

enum HTMLEntities {
  private static let named: [Substring: String] = [
    "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "ensp": " ", "emsp": " ",
    "thinsp": " ", "shy": "", "zwj": "", "zwnj": "", "lrm": "", "rlm": "",
    "ndash": "\u{2013}", "mdash": "\u{2014}", "minus": "\u{2212}", "hellip": "\u{2026}",
    "lsquo": "\u{2018}", "rsquo": "\u{2019}", "sbquo": "\u{201A}", "ldquo": "\u{201C}", "rdquo": "\u{201D}",
    "bdquo": "\u{201E}", "laquo": "\u{00AB}", "raquo": "\u{00BB}", "lsaquo": "\u{2039}", "rsaquo": "\u{203A}",
    "bull": "\u{2022}", "middot": "\u{00B7}", "prime": "\u{2032}", "Prime": "\u{2033}", "deg": "\u{00B0}",
    "times": "\u{00D7}", "divide": "\u{00F7}", "plusmn": "\u{00B1}", "frac12": "\u{00BD}", "frac14": "\u{00BC}",
    "frac34": "\u{00BE}", "frac13": "\u{2153}", "frac23": "\u{2154}", "sup1": "\u{00B9}", "sup2": "\u{00B2}",
    "sup3": "\u{00B3}", "micro": "\u{00B5}", "para": "\u{00B6}", "sect": "\u{00A7}", "copy": "\u{00A9}",
    "reg": "\u{00AE}", "trade": "\u{2122}", "euro": "\u{20AC}", "pound": "\u{00A3}", "cent": "\u{00A2}",
    "yen": "\u{00A5}", "iexcl": "\u{00A1}", "iquest": "\u{00BF}", "rarr": "\u{2192}", "larr": "\u{2190}",
    "uarr": "\u{2191}", "darr": "\u{2193}", "hearts": "\u{2665}", "star": "\u{2606}", "check": "\u{2713}",
    "agrave": "\u{00E0}", "aacute": "\u{00E1}", "acirc": "\u{00E2}", "atilde": "\u{00E3}", "auml": "\u{00E4}",
    "aring": "\u{00E5}", "aelig": "\u{00E6}", "ccedil": "\u{00E7}", "egrave": "\u{00E8}", "eacute": "\u{00E9}",
    "ecirc": "\u{00EA}", "euml": "\u{00EB}", "igrave": "\u{00EC}", "iacute": "\u{00ED}", "icirc": "\u{00EE}",
    "iuml": "\u{00EF}", "ntilde": "\u{00F1}", "ograve": "\u{00F2}", "oacute": "\u{00F3}", "ocirc": "\u{00F4}",
    "otilde": "\u{00F5}", "ouml": "\u{00F6}", "oslash": "\u{00F8}", "ugrave": "\u{00F9}", "uacute": "\u{00FA}",
    "ucirc": "\u{00FB}", "uuml": "\u{00FC}", "yacute": "\u{00FD}", "yuml": "\u{00FF}", "szlig": "\u{00DF}",
    "Agrave": "\u{00C0}", "Aacute": "\u{00C1}", "Acirc": "\u{00C2}", "Auml": "\u{00C4}", "Aring": "\u{00C5}",
    "Ccedil": "\u{00C7}", "Egrave": "\u{00C8}", "Eacute": "\u{00C9}", "Ecirc": "\u{00CA}", "Iacute": "\u{00CD}",
    "Ntilde": "\u{00D1}", "Oacute": "\u{00D3}", "Ouml": "\u{00D6}", "Oslash": "\u{00D8}", "Uacute": "\u{00DA}",
    "Uuml": "\u{00DC}", "oelig": "\u{0153}", "OElig": "\u{0152}",
  ]

  static func decode(_ text: String) -> String {
    guard text.contains("&") else { return text }
    var result = ""
    result.reserveCapacity(text.utf8.count)
    var remainder = text[...]
    while let ampersand = remainder.firstIndex(of: "&") {
      result += remainder[..<ampersand]
      let afterAmpersand = remainder.index(after: ampersand)
      let window = remainder[afterAmpersand...].prefix(32)
      if let semicolon = window.firstIndex(of: ";"), let decoded = entity(remainder[afterAmpersand..<semicolon]) {
        result += decoded
        remainder = remainder[remainder.index(after: semicolon)...]
      } else {
        result += "&"
        remainder = remainder[afterAmpersand...]
      }
    }
    result += remainder
    return result
  }

  private static func entity(_ name: Substring) -> String? {
    if name.first == "#" {
      let digits = name.dropFirst()
      let value: UInt32? =
        if digits.first == "x" || digits.first == "X" {
          UInt32(digits.dropFirst(), radix: 16)
        } else {
          UInt32(digits, radix: 10)
        }
      guard let value, value != 0, let scalar = Unicode.Scalar(value) else { return nil }
      return String(Character(scalar))
    }
    return named[name]
  }
}
