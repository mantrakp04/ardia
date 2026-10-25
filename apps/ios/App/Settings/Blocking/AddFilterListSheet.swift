import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct AddFilterListSheet: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var address = ""
  @State private var failure: String?
  @State private var isAdding = false
  @State private var added = 0
  @State private var failures = 0
  @FocusState private var isFocused: Bool

  var body: some View {
    let validation = FilterListAddress.validate(address)
    NavigationStack {
      Form {
        Section {
          TextField("https://example.com/filters.txt", text: $address)
            .keyboardType(.URL)
            .textContentType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($isFocused)
            .submitLabel(.done)
            .onSubmit(add)
            .onChange(of: address) { _, _ in failure = nil }
        } header: {
          Text("List Address")
        } footer: {
          Group {
            if let failure {
              Text(failure).foregroundStyle(.ink(.red))
            } else if case .invalid(let message) = validation, !address.isEmpty {
              Text(message).foregroundStyle(.secondary)
            } else {
              Text("Paste the address of a list in Adblock Plus or uBlock Origin format. You can find lists at filterlists.com.")
            }
          }
          .contentTransition(.opacity)
        }

        if address.isEmpty {
          Section {
            PasteButton(payloadType: URL.self) { urls in
              guard let url = urls.first else { return }
              address = url.absoluteString
            }
            .buttonBorderShape(.capsule)
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
          }
        }
      }
      .navigationTitle("Add a List")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if isAdding {
            ProgressView()
          } else {
            Button("Add", role: .confirm, action: add)
              .disabled(validation.url == nil)
          }
        }
      }
      .onAppear { isFocused = true }
      .interactiveDismissDisabled(isAdding)
      .sensoryFeedback(.success, trigger: added)
      .sensoryFeedback(.error, trigger: failures)
    }
    .tint(Color.ardiaAccentText)
    .presentationDetents([.medium, .large])
  }

  private func add() {
    guard let url = FilterListAddress.validate(address).url, !isAdding else { return }
    isAdding = true
    Task {
      let message = await app.filterLists.addList(url)
      isAdding = false
      if let message {
        failure = message
        failures += 1
      } else {
        added += 1
        dismiss()
      }
    }
  }
}

enum FilterListAddress {
  enum Validation: Equatable {
    case valid(URL)
    case invalid(String)

    var url: URL? {
      if case .valid(let url) = self { url } else { nil }
    }
  }

  static func validate(_ text: String) -> Validation {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .invalid(String(localized: "Enter the list’s address.")) }
    guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
      let host = url.host(), host.contains(".")
    else {
      return .invalid(FilterListError.invalidAddress.message)
    }
    return .valid(url)
  }
}

#Preview("Add a List") {
  AddFilterListSheet()
    .environment(AppModel(isDemo: true))
}
