import AppKit
import IOKit.ps

final class SystemState {
  static let shared = SystemState()
  var onChange: (([String: Any]) -> Void)?
  private var memoryPressure = "normal"
  private var memorySource: DispatchSourceMemoryPressure?
  private var powerSource: CFRunLoopSource?
  private var lowPowerObserver: NSObjectProtocol?

  var snapshot: [String: Any] {
    let battery = SystemState.battery()
    return [
      "onBattery": battery.onBattery,
      "batteryLevel": battery.level as Any,
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "memoryPressure": memoryPressure,
      "physicalMemory": Double(ProcessInfo.processInfo.physicalMemory),
    ]
  }

  func start() {
    guard memorySource == nil else { return }
    let source = DispatchSource.makeMemoryPressureSource(eventMask: [.normal, .warning, .critical], queue: .main)
    source.setEventHandler { [weak self, weak source] in
      guard let self, let event = source?.data else { return }
      self.memoryPressure = event.contains(.critical) ? "critical" : event.contains(.warning) ? "warning" : "normal"
      self.changed()
    }
    source.resume()
    memorySource = source

    let context = Unmanaged.passUnretained(self).toOpaque()
    if let loop = IOPSNotificationCreateRunLoopSource({ context in
      guard let context else { return }
      Unmanaged<SystemState>.fromOpaque(context).takeUnretainedValue().changed()
    }, context)?.takeRetainedValue() {
      CFRunLoopAddSource(CFRunLoopGetMain(), loop, .defaultMode)
      powerSource = loop
    }
    lowPowerObserver = NotificationCenter.default.addObserver(
      forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
    ) { [weak self] _ in self?.changed() }
  }

  private func changed() {
    let state = snapshot
    if Thread.isMainThread { onChange?(state) } else { DispatchQueue.main.async { self.onChange?(state) } }
  }

  private static func battery() -> (onBattery: Bool, level: Double?) {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return (false, nil) }
    let providing = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?
    var level: Double?
    let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] ?? []
    for source in sources {
      guard let description = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
        description[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
        let current = description[kIOPSCurrentCapacityKey] as? Double,
        let max = description[kIOPSMaxCapacityKey] as? Double, max > 0
      else { continue }
      level = current / max
    }
    return (providing == kIOPMBatteryPowerKey, level)
  }
}
