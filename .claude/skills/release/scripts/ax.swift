import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count >= 3, let pid = pid_t(args[1]) else {
  FileHandle.standardError.write("usage: ax <pid> windows | press <button title>\n".data(using: .utf8)!)
  exit(2)
}
guard AXIsProcessTrusted() else {
  FileHandle.standardError.write("ax: this process isn't trusted for Accessibility\n".data(using: .utf8)!)
  exit(3)
}

func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value as? T
}

func buttons(in element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
  guard depth < 12 else { return [] }
  let children: [AXUIElement] = attribute(element, kAXChildrenAttribute) ?? []
  return children.flatMap { child -> [AXUIElement] in
    let role: String? = attribute(child, kAXRoleAttribute)
    return (role == kAXButtonRole ? [child] : []) + buttons(in: child, depth: depth + 1)
  }
}

let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 5)
let windows: [AXUIElement] = attribute(app, kAXWindowsAttribute) ?? []

switch args[2] {
case "windows":
  let listed = windows.map { window -> [String: Any] in
    let title: String = attribute(window, kAXTitleAttribute) ?? ""
    let titles = buttons(in: window).compactMap { (button: AXUIElement) -> String? in attribute(button, kAXTitleAttribute) }
    return ["title": title, "buttons": titles.filter { !$0.isEmpty }]
  }
  let data = try JSONSerialization.data(withJSONObject: listed)
  print(String(data: data, encoding: .utf8)!)
case "press" where args.count == 4:
  for window in windows {
    for button in buttons(in: window) where (attribute(button, kAXTitleAttribute) as String?) == args[3] {
      exit(AXUIElementPerformAction(button, kAXPressAction as CFString) == .success ? 0 : 1)
    }
  }
  FileHandle.standardError.write("ax: no button \"\(args[3])\" in pid \(pid)'s windows\n".data(using: .utf8)!)
  exit(1)
default:
  exit(2)
}
