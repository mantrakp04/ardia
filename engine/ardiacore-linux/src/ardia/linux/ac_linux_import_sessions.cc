#include "ardia/linux/ac_linux_import_sessions.h"

#include <sys/stat.h>

#include <algorithm>
#include <cstdio>
#include <map>
#include <set>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_import_formats.h"
#include "base/json/json_reader.h"

namespace ardia::linux_import {

namespace {

constexpr uint32_t kSignature = 0x53534E53;
constexpr uint8_t kMarker = 255;
constexpr int64_t kWebKitOffsetMicros = 11644473600000000LL;
constexpr const char* kGroupColors[] = {"grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"};

enum Command : uint8_t {
  kSetTabWindow = 0,
  kSetTabIndexInWindow = 2,
  kPrunedFromBack = 5,
  kUpdateTabNavigation = 6,
  kSetSelectedNavigationIndex = 7,
  kSetSelectedTabInIndex = 8,
  kSetWindowType = 9,
  kPrunedFromFront = 11,
  kSetPinnedState = 12,
  kTabClosed = 16,
  kWindowClosed = 17,
  kLastActiveTime = 21,
  kPruned = 24,
  kSetTabGroup = 25,
  kSetTabGroupMetadata2 = 27,
};

class Reader {
 public:
  explicit Reader(std::string_view data) : data_(data) {}

  size_t offset() const { return offset_; }
  size_t remaining() const { return data_.size() - offset_; }
  bool Bytes(size_t count, std::string_view* out) {
    if (remaining() < count) return false;
    *out = data_.substr(offset_, count);
    offset_ += count;
    return true;
  }
  bool Skip(size_t count) {
    std::string_view ignored;
    return Bytes(count, &ignored);
  }
  template <typename T>
  bool Number(T* out) {
    std::string_view bytes;
    if (!Bytes(sizeof(T), &bytes)) return false;
    uint64_t value = 0;
    for (size_t i = 0; i < sizeof(T); ++i) value |= static_cast<uint64_t>(static_cast<uint8_t>(bytes[i])) << (8 * i);
    *out = static_cast<T>(value);
    return true;
  }
  void Align() {
    const size_t pad = (4 - offset_ % 4) % 4;
    offset_ = std::min(data_.size(), offset_ + pad);
  }

 private:
  std::string_view data_;
  size_t offset_ = 0;
};

bool PickleString(Reader& reader, std::string* out) {
  int32_t size = 0;
  std::string_view bytes;
  if (!reader.Number(&size) || size < 0 || !reader.Bytes(static_cast<size_t>(size), &bytes)) return false;
  reader.Align();
  out->assign(bytes);
  return true;
}

void AppendUtf8(uint32_t code, std::string* out) {
  if (code < 0x80) {
    out->push_back(static_cast<char>(code));
  } else if (code < 0x800) {
    out->push_back(static_cast<char>(0xc0 | (code >> 6)));
    out->push_back(static_cast<char>(0x80 | (code & 0x3f)));
  } else if (code < 0x10000) {
    out->push_back(static_cast<char>(0xe0 | (code >> 12)));
    out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
    out->push_back(static_cast<char>(0x80 | (code & 0x3f)));
  } else {
    out->push_back(static_cast<char>(0xf0 | (code >> 18)));
    out->push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3f)));
    out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
    out->push_back(static_cast<char>(0x80 | (code & 0x3f)));
  }
}

bool PickleString16(Reader& reader, std::string* out) {
  int32_t units = 0;
  std::string_view bytes;
  if (!reader.Number(&units) || units < 0 || units > (1 << 24) ||
      !reader.Bytes(static_cast<size_t>(units) * 2, &bytes)) {
    return false;
  }
  reader.Align();
  out->clear();
  for (size_t i = 0; i + 1 < bytes.size(); i += 2) {
    uint32_t unit = static_cast<uint8_t>(bytes[i]) | (static_cast<uint32_t>(static_cast<uint8_t>(bytes[i + 1])) << 8);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 3 < bytes.size()) {
      const uint32_t low = static_cast<uint8_t>(bytes[i + 2]) | (static_cast<uint32_t>(static_cast<uint8_t>(bytes[i + 3])) << 8);
      if (low >= 0xdc00 && low <= 0xdfff) {
        unit = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
        i += 2;
      } else {
        unit = 0xfffd;
      }
    } else if (unit >= 0xd800 && unit <= 0xdfff) {
      unit = 0xfffd;
    }
    AppendUtf8(unit, out);
  }
  return true;
}

std::string GroupId(uint64_t high, uint64_t low) {
  char buffer[33];
  std::snprintf(buffer, sizeof(buffer), "%016llX%016llX", static_cast<unsigned long long>(high),
                static_cast<unsigned long long>(low));
  return buffer;
}

std::string WithoutContainerPrefix(const std::string& url) {
  if (url.rfind("containers+", 0) != 0) return url;
  const size_t colon = url.find(':');
  if (colon == std::string::npos) return url;
  const std::string inner = url.substr(colon + 1);
  const size_t scheme = inner.find(':');
  return scheme == std::string::npos || scheme == 0 ? url : inner;
}

struct Navigation {
  int32_t index = 0;
  std::string url;
  std::string title;
};

struct TabState {
  int32_t window = 0;
  int32_t visual_index = 0;
  std::vector<Navigation> navigations;
  int32_t current = 0;
  bool pinned = false;
  std::string group;
  double last_active = 0;

  size_t Closest(int32_t index) const {
    for (size_t i = 0; i < navigations.size(); ++i) {
      if (navigations[i].index >= index) return i;
    }
    return navigations.size();
  }
  void Prune(int32_t index, int32_t count) {
    if (current >= index && current < index + count) {
      current = index - 1;
    } else if (current >= index + count) {
      current -= count;
    }
    const size_t from = Closest(index);
    const size_t to = std::max(from, Closest(index + count));
    navigations.erase(navigations.begin() + static_cast<long>(from), navigations.begin() + static_cast<long>(to));
    for (Navigation& navigation : navigations) {
      if (navigation.index >= index) navigation.index -= count;
    }
  }
};

struct WindowState {
  int32_t selected = 0;
  std::optional<int32_t> type;
};

struct Group {
  std::string title;
  std::string color = "grey";
  bool collapsed = false;
};

struct SessionState {
  std::map<int32_t, TabState> tabs;
  std::map<int32_t, WindowState> windows;
  std::map<std::string, Group> groups;

  void Apply(uint8_t id, std::string_view payload) {
    Reader reader(payload);
    int32_t a = 0;
    int32_t b = 0;
    switch (id) {
      case kSetTabWindow:
        if (reader.Number(&a) && reader.Number(&b)) tabs[b].window = a;
        break;
      case kSetTabIndexInWindow:
        if (reader.Number(&a) && reader.Number(&b)) tabs[a].visual_index = b;
        break;
      case kPrunedFromBack:
        if (reader.Number(&a) && reader.Number(&b)) {
          TabState& tab = tabs[a];
          tab.navigations.erase(tab.navigations.begin() + static_cast<long>(tab.Closest(b)), tab.navigations.end());
        }
        break;
      case kPrunedFromFront:
        if (reader.Number(&a) && reader.Number(&b) && b > 0) tabs[a].Prune(0, b);
        break;
      case kPruned: {
        int32_t count = 0;
        if (reader.Number(&a) && reader.Number(&b) && reader.Number(&count) && b >= 0 && count > 0) tabs[a].Prune(b, count);
        break;
      }
      case kUpdateTabNavigation: {
        Reader pickle(payload);
        uint32_t header = 0;
        Navigation navigation;
        if (!pickle.Number(&header) || !pickle.Number(&a) || !pickle.Number(&navigation.index) ||
            !PickleString(pickle, &navigation.url) || !PickleString16(pickle, &navigation.title)) {
          break;
        }
        TabState& tab = tabs[a];
        const size_t at = tab.Closest(navigation.index);
        if (at < tab.navigations.size() && tab.navigations[at].index == navigation.index) {
          tab.navigations[at] = std::move(navigation);
        } else {
          tab.navigations.insert(tab.navigations.begin() + static_cast<long>(at), std::move(navigation));
        }
        break;
      }
      case kSetSelectedNavigationIndex:
        if (reader.Number(&a) && reader.Number(&b)) tabs[a].current = b;
        break;
      case kSetSelectedTabInIndex:
        if (reader.Number(&a) && reader.Number(&b)) windows[a].selected = b;
        break;
      case kSetWindowType:
        if (reader.Number(&a) && reader.Number(&b)) windows[a].type = b;
        break;
      case kSetPinnedState: {
        uint8_t pinned = 0;
        if (reader.Number(&a) && reader.Number(&pinned)) tabs[a].pinned = pinned != 0;
        break;
      }
      case kTabClosed:
        if (reader.Number(&a)) tabs.erase(a);
        break;
      case kWindowClosed:
        if (reader.Number(&a)) windows.erase(a);
        break;
      case kLastActiveTime: {
        int64_t micros = 0;
        if (reader.Number(&a) && reader.Skip(4) && reader.Number(&micros) && micros > kWebKitOffsetMicros) {
          tabs[a].last_active = static_cast<double>(micros - kWebKitOffsetMicros) / 1000;
        }
        break;
      }
      case kSetTabGroup: {
        uint64_t high = 0;
        uint64_t low = 0;
        uint8_t has = 0;
        if (reader.Number(&a) && reader.Skip(4) && reader.Number(&high) && reader.Number(&low) && reader.Number(&has)) {
          tabs[a].group = has ? GroupId(high, low) : std::string();
        }
        break;
      }
      case kSetTabGroupMetadata2: {
        Reader pickle(payload);
        uint32_t header = 0;
        uint64_t high = 0;
        uint64_t low = 0;
        uint32_t color = 0;
        Group group;
        if (!pickle.Number(&header) || !pickle.Number(&high) || !pickle.Number(&low) ||
            !PickleString16(pickle, &group.title) || !pickle.Number(&color)) {
          break;
        }
        int32_t collapsed = 0;
        if (pickle.Number(&collapsed)) group.collapsed = collapsed != 0;
        group.color = color < std::size(kGroupColors) ? kGroupColors[color] : "grey";
        groups[GroupId(high, low)] = std::move(group);
        break;
      }
      default:
        break;
    }
  }

  void Export(OpenTabs* out) {
    std::vector<int32_t> window_ids;
    for (const auto& [id, window] : windows) {
      if (window.type == 0) window_ids.push_back(id);
    }
    std::set<std::string> used;
    int window_index = 0;
    for (const int32_t window_id : window_ids) {
      std::vector<std::pair<int32_t, const TabState*>> listed;
      for (const auto& [id, tab] : tabs) {
        if (tab.window == window_id && !tab.navigations.empty()) listed.emplace_back(id, &tab);
      }
      std::sort(listed.begin(), listed.end(), [](const auto& x, const auto& y) {
        return x.second->visual_index != y.second->visual_index ? x.second->visual_index < y.second->visual_index
                                                                : x.first < y.first;
      });
      const int32_t selected = windows[window_id].selected;
      int position = 0;
      for (const auto& [id, tab] : listed) {
        const size_t at = tab->Closest(tab->current);
        const Navigation& navigation = at < tab->navigations.size() ? tab->navigations[at] : tab->navigations.back();
        const int index = position++;
        if (navigation.url.empty() || !ValidUtf8(navigation.url) || out->count >= static_cast<int>(kMaxImportedTabs)) {
          continue;
        }
        base::DictValue entry;
        entry.Set("url", WithoutContainerPrefix(navigation.url));
        entry.Set("title", ValidUtf8(navigation.title) ? navigation.title : std::string());
        entry.Set("pinned", tab->pinned);
        if (!tab->group.empty()) {
          entry.Set("groupId", tab->group);
          used.insert(tab->group);
        }
        entry.Set("windowIndex", window_index);
        entry.Set("active", index == selected);
        if (tab->last_active > 0) entry.Set("lastActive", tab->last_active);
        out->tabs.Append(std::move(entry));
        ++out->count;
      }
      ++window_index;
    }
    for (const std::string& id : used) {
      const auto found = groups.find(id);
      base::DictValue group;
      group.Set("id", id);
      group.Set("title", found == groups.end() ? std::string() : found->second.title);
      group.Set("color", found == groups.end() ? std::string("grey") : found->second.color);
      group.Set("collapsed", found != groups.end() && found->second.collapsed);
      out->groups.Append(std::move(group));
    }
  }
};

struct SessionFile {
  std::string path;
  bool encrypted = false;
  int64_t stamp = 0;
};

std::vector<SessionFile> SessionFiles(const std::string& profile) {
  std::vector<SessionFile> files;
  for (const auto& [folder, encrypted] : {std::pair<const char*, bool>{"Sessions", false}, {"Sessions_Encrypted", true}}) {
    const std::string directory = Join(profile, folder);
    for (const std::string& name : ListDirectory(directory)) {
      if (name.rfind("Session_", 0) != 0) continue;
      int64_t stamp = 0;
      if (!ParseInt64(name.substr(8), &stamp)) continue;
      const std::string path = Join(directory, name);
      if (IsFile(path)) files.push_back(SessionFile{path, encrypted, stamp});
    }
  }
  if (!files.empty()) {
    std::sort(files.begin(), files.end(), [](const SessionFile& x, const SessionFile& y) {
      return x.stamp != y.stamp ? x.stamp > y.stamp : x.encrypted && !y.encrypted;
    });
    return files;
  }
  for (const char* name : {"Current Session", "Last Session"}) {
    const std::string path = Join(profile, name);
    if (IsFile(path)) files.push_back(SessionFile{path, false, 0});
  }
  return files;
}

bool CompleteCleartext(const std::string& path) {
  std::string data;
  if (ReadFileLimited(path, kMaxSessionBytes, &data) != FileRead::kOk) return false;
  Reader reader(data);
  uint32_t signature = 0;
  uint32_t version = 0;
  if (!reader.Number(&signature) || signature != kSignature || !reader.Number(&version)) return false;
  if (version == 1) return true;
  if (version != 3) return false;
  uint16_t size = 0;
  std::string_view body;
  while (reader.Number(&size) && size >= 1 && reader.Bytes(size, &body)) {
    if (size == 1 && static_cast<uint8_t>(body[0]) == kMarker) return true;
  }
  return false;
}

double Modified(const std::string& path) {
  struct stat info;
  return stat(path.c_str(), &info) == 0 ? static_cast<double>(info.st_mtim.tv_sec) * 1e9 + info.st_mtim.tv_nsec : -1;
}

}

std::optional<Failure> ParseChromiumSession(std::string_view data, const SecretBytes* key, OpenTabs* out) {
  Reader reader(data);
  uint32_t signature = 0;
  uint32_t version = 0;
  if (!reader.Number(&signature) || signature != kSignature || !reader.Number(&version)) {
    return Failure{"unreadable", "Not a Chromium session file"};
  }
  SessionState state;
  bool marker = false;
  if (version == 1 || version == 3) {
    uint16_t size = 0;
    std::string_view body;
    while (reader.Number(&size) && size >= 1 && reader.Bytes(size, &body)) {
      const uint8_t id = static_cast<uint8_t>(body[0]);
      if (id == kMarker && size == 1) marker = true;
      state.Apply(id, body.substr(1));
    }
    if (version == 3 && !marker) return Failure{"unreadable", "This session file is incomplete"};
  } else if (version == 5) {
    if (!key) return Failure{"locked", "This session file is encrypted; unlock the browser first"};
    uint32_t size = 0;
    std::string_view blob;
    while (reader.Number(&size) && reader.Bytes(size, &blob)) {
      std::string plain;
      if (DecryptChromiumBytes(blob, key, &plain) != ValueDecrypt::kOk || plain.empty()) break;
      const uint8_t id = static_cast<uint8_t>(plain[0]);
      if (id == kMarker && plain.size() == 1) marker = true;
      state.Apply(id, std::string_view(plain).substr(1));
      Wipe(plain);
    }
    if (!marker) return Failure{"locked", "Couldn't decrypt the session file with this key"};
  } else {
    return Failure{"unsupported", "Unsupported session file version " + std::to_string(version)};
  }
  state.Export(out);
  return std::nullopt;
}

bool ChromiumSessionNeedsKey(const std::string& profile) {
  const std::vector<SessionFile> files = SessionFiles(profile);
  if (std::none_of(files.begin(), files.end(), [](const SessionFile& f) { return f.encrypted; })) return false;
  return std::none_of(files.begin(), files.end(),
                      [](const SessionFile& f) { return !f.encrypted && CompleteCleartext(f.path); });
}

std::optional<Failure> ReadChromiumTabs(const std::string& profile, const SecretBytes* key, OpenTabs* out) {
  const std::vector<SessionFile> files = SessionFiles(profile);
  if (files.empty()) return Failure{"empty", "No session file in this profile"};
  std::optional<Failure> first;
  for (const SessionFile& file : files) {
    if (file.encrypted && !key) continue;
    std::string data;
    const FileRead read = ReadFileLimited(file.path, kMaxSessionBytes, &data);
    if (read != FileRead::kOk) {
      if (!first) first = Failure{read == FileRead::kTooLarge ? "tooLarge" : "unreadable", "Couldn't read the session file"};
      continue;
    }
    OpenTabs tabs;
    std::optional<Failure> failure = ParseChromiumSession(data, key, &tabs);
    if (!failure) {
      *out = std::move(tabs);
      return std::nullopt;
    }
    if (!first) first = std::move(failure);
  }
  return first ? first : Failure{"locked", "This session file is encrypted; unlock the browser first"};
}

std::optional<Failure> ParseFirefoxSession(std::string_view json, OpenTabs* out) {
  std::optional<base::DictValue> top = base::JSONReader::ReadDict(json, base::JSON_PARSE_RFC);
  const base::ListValue* windows = top ? top->FindList("windows") : nullptr;
  if (!windows) return Failure{"unreadable", "Session store has no windows"};
  int window_index = 0;
  std::set<std::string> groups_seen;
  for (const base::Value& window_value : *windows) {
    if (!window_value.is_dict()) {
      ++window_index;
      continue;
    }
    const base::DictValue& window = window_value.GetDict();
    const std::optional<int> selected_one = window.FindInt("selected");
    const int selected = selected_one ? (*selected_one > 0 ? *selected_one - 1 : -1) : 0;
    const base::ListValue* tabs = window.FindList("tabs");
    int position = -1;
    const size_t tab_count = tabs ? tabs->size() : 0;
    for (size_t t = 0; t < tab_count; ++t) {
      const base::Value& tab_value = (*tabs)[t];
      ++position;
      if (!tab_value.is_dict()) continue;
      const base::DictValue& tab = tab_value.GetDict();
      if (tab.FindBool("hidden").value_or(false)) continue;
      const base::ListValue* entries = tab.FindList("entries");
      if (!entries || entries->empty()) continue;
      const int count = static_cast<int>(entries->size());
      const int index = std::clamp(tab.FindInt("index").value_or(count), 1, count) - 1;
      const base::Value& entry_value = (*entries)[static_cast<size_t>(index)];
      if (!entry_value.is_dict()) continue;
      const std::string* url = entry_value.GetDict().FindString("url");
      if (!url || url->empty() || out->count >= static_cast<int>(kMaxImportedTabs)) continue;
      const std::string* title = entry_value.GetDict().FindString("title");
      base::DictValue entry;
      entry.Set("url", *url);
      entry.Set("title", title ? *title : std::string());
      entry.Set("pinned", tab.FindBool("pinned").value_or(false));
      if (const std::string* group = tab.FindString("groupId")) entry.Set("groupId", *group);
      entry.Set("windowIndex", window_index);
      entry.Set("active", position == selected);
      if (std::optional<double> accessed = tab.FindDouble("lastAccessed"); accessed && *accessed > 0) {
        entry.Set("lastActive", *accessed);
      }
      out->tabs.Append(std::move(entry));
      ++out->count;
    }
    if (const base::ListValue* groups = window.FindList("groups")) {
      for (const base::Value& group_value : *groups) {
        if (!group_value.is_dict()) continue;
        const base::DictValue& group = group_value.GetDict();
        const std::string* id = group.FindString("id");
        if (!id || !groups_seen.insert(*id).second) continue;
        const std::string* name = group.FindString("name");
        const std::string* color = group.FindString("color");
        base::DictValue made;
        made.Set("id", *id);
        made.Set("title", name ? *name : std::string());
        made.Set("color", color ? *color : std::string("grey"));
        made.Set("collapsed", group.FindBool("collapsed").value_or(false));
        out->groups.Append(std::move(made));
      }
    }
    ++window_index;
  }
  return std::nullopt;
}

std::optional<Failure> ReadFirefoxTabs(const std::string& profile, OpenTabs* out) {
  std::string chosen;
  double newest = -1;
  for (const char* name : {"sessionstore-backups/recovery.jsonlz4", "sessionstore.jsonlz4", "sessionstore-backups/previous.jsonlz4"}) {
    const std::string path = Join(profile, name);
    if (!IsFile(path)) continue;
    const double modified = Modified(path);
    if (modified > newest) {
      newest = modified;
      chosen = path;
    }
  }
  if (chosen.empty()) return Failure{"empty", "No session store in this profile"};
  std::string compressed;
  const FileRead read = ReadFileLimited(chosen, kMaxSessionBytes, &compressed);
  if (read != FileRead::kOk) return Failure{read == FileRead::kTooLarge ? "tooLarge" : "unreadable", "Couldn't read the session store"};
  std::string json;
  if (!DecompressMozLz4(compressed, &json)) return Failure{"unreadable", "Couldn't decompress the session store"};
  return ParseFirefoxSession(json, out);
}

}
