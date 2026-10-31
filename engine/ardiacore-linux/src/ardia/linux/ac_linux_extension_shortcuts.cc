#include "ardia/linux/ac_linux_extension_shortcuts.h"

namespace ardia::linux_extension_shortcuts {

bool IsActionCommand(std::string_view command) {
  return command == kActionCommand || command == kBrowserActionCommand || command == kPageActionCommand;
}

ShortcutBook::ShortcutBook() = default;
ShortcutBook::~ShortcutBook() = default;

void ShortcutBook::Register(Key key, std::string_view extension_id, std::string_view command) {
  entries_[key] = Entry{std::string(extension_id), std::string(command)};
}

void ShortcutBook::Unregister(Key key) {
  entries_.erase(key);
}

Decision ShortcutBook::Decide(Key key, bool repeat, bool reserved_by_ardia) const {
  Decision decision;
  if (reserved_by_ardia) return decision;
  const auto found = entries_.find(key);
  if (found == entries_.end()) return decision;
  decision.extension_id = found->second.extension_id;
  decision.command = found->second.command;
  if (!IsActionCommand(found->second.command)) {
    decision.route = Route::kCommand;
  } else {
    decision.route = repeat ? Route::kSwallow : Route::kAction;
  }
  return decision;
}

}
