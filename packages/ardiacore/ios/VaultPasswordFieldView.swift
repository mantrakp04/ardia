import AppKit
import ExpoModulesCore

final class VaultPasswordFieldView: ExpoView, NSTextFieldDelegate {
  let onEdit = EventDispatcher()
  let onSubmit = EventDispatcher()
  let onEscape = EventDispatcher()

  var draft = "" {
    didSet {
      guard draft != oldValue else { return }
      if !oldValue.isEmpty { VaultPasswordDrafts.drop(oldValue) }
      load()
    }
  }

  var revealed = false {
    didSet {
      guard revealed != oldValue else { return }
      swap()
    }
  }

  var placeholder = "" {
    didSet {
      secureField.placeholderString = placeholder
      shown.placeholderString = placeholder
    }
  }

  private let secureField = NSSecureTextField()
  private let shown = NSTextField()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    for field in [secureField, shown] {
      field.bezelStyle = .roundedBezel
      field.isBezeled = true
      field.font = .systemFont(ofSize: NSFont.systemFontSize)
      field.usesSingleLineMode = true
      field.lineBreakMode = .byClipping
      field.cell?.isScrollable = true
      field.delegate = self
      addSubview(field)
    }
    shown.isHidden = true
  }

  override func layout() {
    super.layout()
    secureField.frame = bounds
    shown.frame = bounds
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard window == nil, !draft.isEmpty else { return }
    draft = ""
  }

  private var active: NSTextField { revealed ? shown : secureField }

  private func load() {
    let value = VaultPasswordDrafts.value(draft) ?? ""
    secureField.stringValue = value
    shown.stringValue = value
    onEdit(["length": value.count])
  }

  private func swap() {
    let from = revealed ? secureField : shown
    let to = active
    let wasEditing = from.currentEditor() != nil
    to.stringValue = from.stringValue
    from.isHidden = true
    to.isHidden = false
    if wasEditing, let window, window.isKeyWindow {
      window.makeFirstResponder(to)
      to.currentEditor()?.selectedRange = NSRange(location: (to.stringValue as NSString).length, length: 0)
    }
  }

  func controlTextDidChange(_ notification: Notification) {
    guard let field = notification.object as? NSTextField, field === active else { return }
    let value = field.stringValue
    if !draft.isEmpty { VaultPasswordDrafts.edit(draft, to: value) }
    onEdit(["length": value.count])
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    switch selector {
    case #selector(NSResponder.insertNewline(_:)):
      onSubmit([:])
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      onEscape([:])
      return true
    default:
      return false
    }
  }
}

public class VaultPasswordFieldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaVaultPasswordField")

    View(VaultPasswordFieldView.self) {
      Events("onEdit", "onSubmit", "onEscape")
      Prop("draft") { (view: VaultPasswordFieldView, value: String?) in view.draft = value ?? "" }
      Prop("revealed") { (view: VaultPasswordFieldView, value: Bool?) in view.revealed = value ?? false }
      Prop("placeholder") { (view: VaultPasswordFieldView, value: String?) in view.placeholder = value ?? "" }
    }
  }
}
