import ArdiaDesign
import ArdiaSync
import SwiftUI

struct RecoveryPhraseEntryPage: View {
  @Binding var phrase: String

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ""
  @FocusState private var isFocused: Bool

  var body: some View {
    let check = app.sync.check(phrase: draft)
    Form {
      Section {
        TextField("Enter your 24-word recovery phrase", text: $draft, axis: .vertical)
          .lineLimit(5...10)
          .font(.body.monospaced())
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.asciiCapable)
          .privacySensitive()
          .focused($isFocused)
          .submitLabel(.done)
          .onSubmit { useIfValid(check) }
      } header: {
        HStack {
          Text("Recovery Phrase")
          Spacer()
          Text(check.counterText)
            .monospacedDigit()
            .foregroundStyle(check.isTooLong ? AnyShapeStyle(.ink(.red)) : AnyShapeStyle(.secondary))
            .contentTransition(.numericText(value: Double(check.wordCount)))
            .animation(Motion.snappy, value: check.wordCount)
        }
      } footer: {
        Group {
          if let problem = check.problem {
            Text(problem).foregroundStyle(.ink(.red))
          } else if check.isValid {
            Text("All 24 words check out.").foregroundStyle(.ink(.green))
          } else {
            Text("Your Mac shows the words under Settings › Sync › Connect Another Device. Spaces, commas and line breaks between them are fine.")
          }
        }
        .contentTransition(.opacity)
      }

      if draft.isEmpty {
        Section {
          PasteButton(payloadType: String.self) { strings in
            guard let text = strings.first else { return }
            draft = text
          }
          .buttonBorderShape(.capsule)
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
        }
      }
    }
    .navigationTitle("Enter Words")
    .navigationBarTitleDisplayMode(.inline)
    .scrollDismissesKeyboard(.interactively)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button("Use Phrase", role: .confirm) { useIfValid(check) }
          .disabled(!check.isValid)
      }
    }
    .onAppear {
      draft = phrase
      isFocused = phrase.isEmpty
    }
    .sensoryFeedback(.success, trigger: check.isValid) { _, valid in valid }
  }

  private func useIfValid(_ check: PhraseCheck) {
    guard check.isValid else { return }
    phrase = draft
    dismiss()
  }
}

#Preview("Enter Words") {
  NavigationStack {
    RecoveryPhraseEntryPage(phrase: .constant(""))
  }
  .environment(AppModel(isDemo: true))
}
