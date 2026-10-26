import AppKit

public enum WindowHost {
  public static var makeWindow: (() -> NSWindow)?
  public static var makeContentView: ((_ windowId: String) -> NSView)?
}
