import ArdiaDesign
import SwiftUI
import UIKit

struct OmniboxTextField: UIViewRepresentable {
  @Binding var text: String
  @Binding var isFocused: Bool
  var completion: String?
  var placeholder: String
  var isIncognito: Bool
  var selectsAllOnFocus: Bool
  var onSubmit: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  func makeUIView(context: Context) -> CompletingTextField {
    let field = CompletingTextField()
    field.clipsToBounds = true
    field.delegate = context.coordinator
    field.keyboardType = .webSearch
    field.returnKeyType = .go
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.spellCheckingType = .no
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.enablesReturnKeyAutomatically = true
    field.clearButtonMode = .never
    field.adjustsFontForContentSizeCategory = true
    field.font = UIFontMetrics(forTextStyle: .title3).scaledFont(for: .systemFont(ofSize: 20))
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    field.addTarget(context.coordinator, action: #selector(Coordinator.editingChanged(_:)), for: .editingChanged)
    field.accessibilityLabel = String(localized: "Search or Enter Address")
    field.text = text
    apply(to: field)
    return field
  }

  func updateUIView(_ field: CompletingTextField, context: Context) {
    context.coordinator.parent = self
    apply(to: field)
    if field.typedText != text, field.markedTextRange == nil {
      field.replaceText(with: text)
    }
    context.coordinator.showCompletion(completion, in: field)
    if isFocused, !field.isFirstResponder, field.window != nil {
      DispatchQueue.main.async {
        guard self.isFocused, !field.isFirstResponder else { return }
        field.becomeFirstResponder()
      }
    } else if !isFocused, field.isFirstResponder {
      field.resignFirstResponder()
    }
  }

  private func apply(to field: CompletingTextField) {
    let placeholderColor = isIncognito ? UIColor.white.withAlphaComponent(0.45) : UIColor(BrowsePalette.foregroundTertiary)
    field.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: placeholderColor])
    field.textColor = isIncognito ? .white : UIColor(BrowsePalette.foregroundPrimary)
    field.tintColor = UIColor(Palette.indigo)
    field.completionColor = UIColor(Palette.indigo).withAlphaComponent(isIncognito ? 0.45 : 0.18)
    field.keyboardAppearance = isIncognito ? .dark : .default
  }

  @MainActor
  final class Coordinator: NSObject, UITextFieldDelegate {
    var parent: OmniboxTextField
    private var suppressCompletion = false
    private var didSelectAllOnFocus = false

    init(parent: OmniboxTextField) {
      self.parent = parent
    }

    @objc func editingChanged(_ field: CompletingTextField) {
      guard field.markedTextRange == nil else { return }
      field.typedText = field.text ?? ""
      if parent.text != field.typedText { parent.text = field.typedText }
    }

    func showCompletion(_ completion: String?, in field: CompletingTextField) {
      guard field.isFirstResponder, field.markedTextRange == nil, !suppressCompletion,
            let completion, completion.count > field.typedText.count,
            completion.lowercased().hasPrefix(field.typedText.lowercased()),
            !field.hasCompletion, field.text == field.typedText, field.isCaretAtTypedEnd else {
        if completion == nil, field.hasCompletion { field.clearCompletion() }
        return
      }
      field.showCompletion(String(completion.dropFirst(field.typedText.count)))
    }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
      guard let field = textField as? CompletingTextField else { return true }
      suppressCompletion = string.isEmpty
      if field.hasCompletion {
        if string.isEmpty {
          field.clearCompletion()
          return false
        }
        let pending = field.completionSuffix
        if let first = pending.first, string.count == 1, String(first).lowercased() == string.lowercased() {
          field.advanceCompletion()
          parent.text = field.typedText
          return false
        }
        field.clearCompletion()
        field.insertText(string)
        return false
      }
      return true
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
      guard let field = textField as? CompletingTextField else { return true }
      let submitted = field.text ?? ""
      guard !submitted.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
      parent.onSubmit(submitted)
      return false
    }

    func textFieldDidBeginEditing(_ textField: UITextField) {
      if !parent.isFocused { parent.isFocused = true }
      if parent.selectsAllOnFocus, !didSelectAllOnFocus, !(textField.text ?? "").isEmpty {
        didSelectAllOnFocus = true
        DispatchQueue.main.async { textField.selectAll(nil) }
      }
    }

    func textFieldDidChangeSelection(_ textField: UITextField) {
      guard let field = textField as? CompletingTextField, field.hasCompletion, !field.isApplyingCompletion, !field.isCaretAtTypedEnd else { return }
      field.acceptCompletion()
      parent.text = field.typedText
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
      (textField as? CompletingTextField)?.clearCompletion()
      if parent.isFocused { parent.isFocused = false }
    }
  }
}

final class CompletingTextField: UITextField {
  var typedText = ""
  var completionColor = UIColor.systemBlue.withAlphaComponent(0.2)
  private(set) var isApplyingCompletion = false
  private(set) var completionSuffix = ""
  var hasCompletion: Bool { !completionSuffix.isEmpty }
  var typedLength: Int { (typedText as NSString).length }
  static let horizontalInset: CGFloat = 3

  override func textRect(forBounds bounds: CGRect) -> CGRect {
    super.textRect(forBounds: bounds).insetBy(dx: Self.horizontalInset, dy: 0)
  }

  override func editingRect(forBounds bounds: CGRect) -> CGRect {
    super.editingRect(forBounds: bounds).insetBy(dx: Self.horizontalInset, dy: 0)
  }

  override func placeholderRect(forBounds bounds: CGRect) -> CGRect {
    super.placeholderRect(forBounds: bounds).insetBy(dx: Self.horizontalInset, dy: 0)
  }

  func showCompletion(_ suffix: String) {
    guard !suffix.isEmpty else { return clearCompletion() }
    isApplyingCompletion = true
    defer { isApplyingCompletion = false }
    completionSuffix = suffix
    render()
  }

  func advanceCompletion() {
    guard let first = completionSuffix.first else { return }
    isApplyingCompletion = true
    defer { isApplyingCompletion = false }
    typedText += String(first)
    completionSuffix.removeFirst()
    render()
  }

  func acceptCompletion() {
    typedText += completionSuffix
    completionSuffix = ""
    isApplyingCompletion = true
    defer { isApplyingCompletion = false }
    let caret = selectedTextRange
    text = typedText
    if let caret { selectedTextRange = caret }
  }

  func clearCompletion() {
    guard hasCompletion else { return }
    isApplyingCompletion = true
    defer { isApplyingCompletion = false }
    completionSuffix = ""
    text = typedText
    selectedTextRange = textRange(from: endOfDocument, to: endOfDocument)
  }

  func replaceText(with value: String) {
    isApplyingCompletion = true
    defer { isApplyingCompletion = false }
    completionSuffix = ""
    typedText = value
    text = value
  }

  var isCaretAtTypedEnd: Bool {
    guard let selection = selectedTextRange, selection.isEmpty else { return false }
    return offset(from: beginningOfDocument, to: selection.start) == typedLength
  }

  private func render() {
    var attributes = defaultTextAttributes
    let attributed = NSMutableAttributedString(string: typedText, attributes: attributes)
    attributes[.backgroundColor] = completionColor
    attributed.append(NSAttributedString(string: completionSuffix, attributes: attributes))
    attributedText = attributed
    if let caret = position(from: beginningOfDocument, offset: typedLength) {
      selectedTextRange = textRange(from: caret, to: caret)
    }
  }
}
