import Darwin
import QuartzCore

final class ReportProcessUsage {
  struct Summary {
    let cpuPercent: Double
    let footprintStartMB: Double
    let footprintPeakMB: Double
  }

  private var startedAt: CFTimeInterval = 0
  private var cpuAtStart: Double = 0
  private var footprintStart: Double = 0
  private var footprintPeak: Double = 0
  private var sampledAt: CFTimeInterval = 0

  func begin() {
    startedAt = CACurrentMediaTime()
    cpuAtStart = Self.cpuSeconds()
    footprintStart = Self.footprintMB()
    footprintPeak = footprintStart
    sampledAt = startedAt
  }

  func sample() {
    let now = CACurrentMediaTime()
    guard now - sampledAt >= 1 else { return }
    sampledAt = now
    footprintPeak = max(footprintPeak, Self.footprintMB())
  }

  func end() -> Summary {
    let elapsed = CACurrentMediaTime() - startedAt
    footprintPeak = max(footprintPeak, Self.footprintMB())
    let cpu = elapsed > 0 ? (Self.cpuSeconds() - cpuAtStart) / elapsed * 100 : 0
    return Summary(cpuPercent: cpu, footprintStartMB: footprintStart, footprintPeakMB: footprintPeak)
  }

  private static func cpuSeconds() -> Double {
    var usage = rusage()
    getrusage(RUSAGE_SELF, &usage)
    let seconds = { (t: timeval) in Double(t.tv_sec) + Double(t.tv_usec) / 1_000_000 }
    return seconds(usage.ru_utime) + seconds(usage.ru_stime)
  }

  private static func footprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
  }
}
