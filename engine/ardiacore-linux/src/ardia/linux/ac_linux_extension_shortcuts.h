#ifndef ARDIA_LINUX_AC_LINUX_EXTENSION_SHORTCUTS_H_
#define ARDIA_LINUX_AC_LINUX_EXTENSION_SHORTCUTS_H_

#include <map>
#include <string>
#include <string_view>

namespace ardia::linux_extension_shortcuts {

inline constexpr std::string_view kActionCommand = "_execute_action";
inline constexpr std::string_view kBrowserActionCommand = "_execute_browser_action";
inline constexpr std::string_view kPageActionCommand = "_execute_page_action";
inline constexpr std::string_view kActionShortcutEvent = "extensions.actionShortcut";

struct Key {
  int key_code = 0;
  int modifiers = 0;
  bool operator<(const Key& other) const {
    return key_code != other.key_code ? key_code < other.key_code : modifiers < other.modifiers;
  }
  bool operator==(const Key& other) const = default;
};

bool IsActionCommand(std::string_view command);

enum class Route { kNone, kAction, kCommand, kSwallow };

struct Decision {
  Route route = Route::kNone;
  std::string extension_id;
  std::string command;
};

class ShortcutBook {
 public:
  ShortcutBook();
  ~ShortcutBook();
  ShortcutBook(const ShortcutBook&) = delete;
  ShortcutBook& operator=(const ShortcutBook&) = delete;

  void Register(Key key, std::string_view extension_id, std::string_view command);
  void Unregister(Key key);
  bool Contains(Key key) const { return entries_.contains(key); }
  size_t size() const { return entries_.size(); }

  Decision Decide(Key key, bool repeat, bool reserved_by_ardia) const;

 private:
  struct Entry {
    std::string extension_id;
    std::string command;
  };
  std::map<Key, Entry> entries_;
};

}

#endif
